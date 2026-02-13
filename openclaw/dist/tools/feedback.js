"use strict";
/**
 * Feedback tools (7 tools)
 * Reads: xpr_get_feedback, xpr_list_agent_feedback, xpr_get_agent_score, xpr_get_feedback_config
 * Writes: xpr_submit_feedback, xpr_dispute_feedback, xpr_recalculate_score
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFeedbackTools = registerFeedbackTools;
const sdk_1 = require("@xpr-agents/sdk");
const validate_1 = require("../util/validate");
const confirm_1 = require("../util/confirm");
function registerFeedbackTools(api, config) {
    const contracts = config.contracts;
    // ---- READ TOOLS ----
    api.registerTool({
        name: 'xpr_get_feedback',
        description: 'Get a specific feedback entry by ID.',
        parameters: {
            type: 'object',
            required: ['id'],
            properties: {
                id: { type: 'number', description: 'Feedback ID' },
            },
        },
        handler: async ({ id }) => {
            (0, validate_1.validatePositiveInt)(id, 'id');
            const registry = new sdk_1.FeedbackRegistry(config.rpc, undefined, contracts.agentfeed);
            const feedback = await registry.getFeedback(id);
            if (!feedback) {
                return { error: `Feedback #${id} not found` };
            }
            return feedback;
        },
    });
    api.registerTool({
        name: 'xpr_list_agent_feedback',
        description: 'List feedback for a specific agent, with optional score filtering.',
        parameters: {
            type: 'object',
            required: ['agent'],
            properties: {
                agent: { type: 'string', description: 'Agent account name' },
                limit: { type: 'number', description: 'Max results (default 20, max 100)' },
                min_score: { type: 'number', description: 'Minimum score filter (1-5)' },
                max_score: { type: 'number', description: 'Maximum score filter (1-5)' },
            },
        },
        handler: async ({ agent, limit = 20, min_score, max_score }) => {
            (0, validate_1.validateAccountName)(agent);
            const registry = new sdk_1.FeedbackRegistry(config.rpc, undefined, contracts.agentfeed);
            const feedback = await registry.listFeedbackForAgent(agent, {
                limit: Math.min(limit, 100),
                min_score,
                max_score,
            });
            return { feedback, count: feedback.length };
        },
    });
    api.registerTool({
        name: 'xpr_get_agent_score',
        description: 'Get the aggregated reputation score for an agent (total_score, total_weight, feedback_count, avg_score).',
        parameters: {
            type: 'object',
            required: ['agent'],
            properties: {
                agent: { type: 'string', description: 'Agent account name' },
            },
        },
        handler: async ({ agent }) => {
            (0, validate_1.validateAccountName)(agent);
            const registry = new sdk_1.FeedbackRegistry(config.rpc, undefined, contracts.agentfeed);
            const score = await registry.getAgentScore(agent);
            if (!score) {
                return { agent, total_score: 0, total_weight: 0, feedback_count: 0, avg_score: 0 };
            }
            return score;
        },
    });
    api.registerTool({
        name: 'xpr_get_feedback_config',
        description: 'Get the agentfeed contract configuration (min/max score, dispute window, fees).',
        parameters: { type: 'object', properties: {} },
        handler: async () => {
            const registry = new sdk_1.FeedbackRegistry(config.rpc, undefined, contracts.agentfeed);
            return registry.getConfig();
        },
    });
    // ---- WRITE TOOLS ----
    api.registerTool({
        name: 'xpr_submit_feedback',
        description: 'Submit feedback/rating for an agent. Score 1-5, with optional tags, job hash, and evidence.',
        parameters: {
            type: 'object',
            required: ['agent', 'score'],
            properties: {
                agent: { type: 'string', description: 'Agent account being reviewed' },
                score: { type: 'number', description: 'Rating 1-5 (1=poor, 5=excellent)' },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags for categorizing feedback (e.g., ["reliable", "fast"])',
                },
                job_hash: { type: 'string', description: 'Hash of the completed job for verification' },
                evidence_uri: { type: 'string', description: 'IPFS/Arweave URI with evidence' },
                fee_amount: { type: 'number', description: 'Feedback fee in XPR. Check xpr_get_feedback_config for current fee.' },
                confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
            },
        },
        handler: async (params) => {
            if (!config.session)
                throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
            (0, validate_1.validateAccountName)(params.agent, 'agent');
            (0, validate_1.validateScore)(params.score);
            if (params.evidence_uri)
                (0, validate_1.validateUrl)(params.evidence_uri, 'evidence_uri');
            if (params.fee_amount) {
                (0, validate_1.validateAmount)((0, validate_1.xprToSmallestUnits)(params.fee_amount), config.maxTransferAmount);
            }
            const confirmation = (0, confirm_1.needsConfirmation)(config.confirmHighRisk, params.confirmed, 'Submit Feedback', { agent: params.agent, score: params.score, fee: params.fee_amount ? `${params.fee_amount} XPR` : 'none' }, `Submit ${params.score}/5 rating for agent "${params.agent}"` + (params.fee_amount ? ` (fee: ${params.fee_amount} XPR)` : ''));
            if (confirmation)
                return confirmation;
            const registry = new sdk_1.FeedbackRegistry(config.rpc, config.session, contracts.agentfeed);
            const data = {
                agent: params.agent,
                score: params.score,
                tags: params.tags,
                job_hash: params.job_hash,
                evidence_uri: params.evidence_uri,
            };
            if (params.fee_amount) {
                return registry.submitWithFee(data, `${params.fee_amount.toFixed(4)} XPR`);
            }
            return registry.submit(data);
        },
    });
    api.registerTool({
        name: 'xpr_dispute_feedback',
        description: 'Dispute a feedback entry. The agent who received the feedback or the reviewer can dispute.',
        parameters: {
            type: 'object',
            required: ['feedback_id', 'reason'],
            properties: {
                feedback_id: { type: 'number', description: 'ID of the feedback to dispute' },
                reason: { type: 'string', description: 'Reason for the dispute' },
                evidence_uri: { type: 'string', description: 'URI to supporting evidence' },
            },
        },
        handler: async ({ feedback_id, reason, evidence_uri }) => {
            if (!config.session)
                throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
            (0, validate_1.validatePositiveInt)(feedback_id, 'feedback_id');
            (0, validate_1.validateRequired)(reason, 'reason');
            const registry = new sdk_1.FeedbackRegistry(config.rpc, config.session, contracts.agentfeed);
            return registry.dispute(feedback_id, reason, evidence_uri);
        },
    });
    api.registerTool({
        name: 'xpr_recalculate_score',
        description: 'Trigger a recalculation of an agent\'s aggregated reputation score. Permissionless.',
        parameters: {
            type: 'object',
            required: ['agent'],
            properties: {
                agent: { type: 'string', description: 'Agent account to recalculate' },
            },
        },
        handler: async ({ agent }) => {
            if (!config.session)
                throw new Error('Session required: set XPR_ACCOUNT and XPR_PRIVATE_KEY environment variables');
            (0, validate_1.validateAccountName)(agent);
            const registry = new sdk_1.FeedbackRegistry(config.rpc, config.session, contracts.agentfeed);
            return registry.recalculate(agent);
        },
    });
}
//# sourceMappingURL=feedback.js.map