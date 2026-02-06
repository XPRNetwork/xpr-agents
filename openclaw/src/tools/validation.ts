/**
 * Validation tools (9 tools)
 * Reads: xpr_get_validator, xpr_list_validators, xpr_get_validation,
 *        xpr_list_agent_validations, xpr_get_challenge
 * Writes: xpr_register_validator, xpr_submit_validation,
 *         xpr_challenge_validation, xpr_stake_validator
 */

import { ValidationRegistry } from '@xpr-agents/sdk';
import type { ValidationResult } from '@xpr-agents/sdk';
import type { PluginApi, PluginConfig } from '../types';
import {
  validateAccountName,
  validateConfidence,
  validateRequired,
  validatePositiveInt,
  validateValidationResult,
  validateAmount,
} from '../util/validate';
import { needsConfirmation } from '../util/confirm';

export function registerValidationTools(api: PluginApi, config: PluginConfig): void {
  const contracts = config.contracts;

  // ---- READ TOOLS ----

  api.registerTool({
    name: 'xpr_get_validator',
    description: 'Get details for a validator including stake, accuracy score, and specializations.',
    parameters: {
      type: 'object',
      required: ['account'],
      properties: {
        account: { type: 'string', description: 'Validator account name' },
      },
    },
    handler: async ({ account }: { account: string }) => {
      validateAccountName(account);
      const registry = new ValidationRegistry(config.rpc, undefined, contracts.agentvalid);
      const validator = await registry.getValidator(account);
      if (!validator) {
        return { error: `Validator '${account}' not found` };
      }
      return validator;
    },
  });

  api.registerTool({
    name: 'xpr_list_validators',
    description: 'List registered validators with optional filtering by active status, minimum stake, and accuracy.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
        active_only: { type: 'boolean', description: 'Only active validators (default true)' },
        min_stake: { type: 'number', description: 'Minimum stake in XPR smallest units' },
        min_accuracy: { type: 'number', description: 'Minimum accuracy score (0-10000)' },
      },
    },
    handler: async ({ limit = 20, active_only = true, min_stake, min_accuracy }: {
      limit?: number;
      active_only?: boolean;
      min_stake?: number;
      min_accuracy?: number;
    }) => {
      const registry = new ValidationRegistry(config.rpc, undefined, contracts.agentvalid);
      const validators = await registry.listValidators({
        limit: Math.min(limit, 100),
        active_only,
        min_stake,
        min_accuracy,
      });
      return { validators, count: validators.length };
    },
  });

  api.registerTool({
    name: 'xpr_get_validation',
    description: 'Get a specific validation record by ID.',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'Validation ID' },
      },
    },
    handler: async ({ id }: { id: number }) => {
      validatePositiveInt(id, 'id');
      const registry = new ValidationRegistry(config.rpc, undefined, contracts.agentvalid);
      const validation = await registry.getValidation(id);
      if (!validation) {
        return { error: `Validation #${id} not found` };
      }
      return validation;
    },
  });

  api.registerTool({
    name: 'xpr_list_agent_validations',
    description: 'List all validations for a specific agent.',
    parameters: {
      type: 'object',
      required: ['agent'],
      properties: {
        agent: { type: 'string', description: 'Agent account name' },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
    },
    handler: async ({ agent, limit = 20 }: { agent: string; limit?: number }) => {
      validateAccountName(agent);
      const registry = new ValidationRegistry(config.rpc, undefined, contracts.agentvalid);
      const validations = await registry.listValidationsForAgent(agent, Math.min(limit, 100));
      return { validations, count: validations.length };
    },
  });

  api.registerTool({
    name: 'xpr_get_challenge',
    description: 'Get details of a validation challenge by ID, including status, stake, and resolution.',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'Challenge ID' },
      },
    },
    handler: async ({ id }: { id: number }) => {
      validatePositiveInt(id, 'id');
      const registry = new ValidationRegistry(config.rpc, undefined, contracts.agentvalid);
      const challenge = await registry.getChallenge(id);
      if (!challenge) {
        return { error: `Challenge #${id} not found` };
      }
      return challenge;
    },
  });

  // ---- WRITE TOOLS ----

  api.registerTool({
    name: 'xpr_register_validator',
    description: 'Register as a validator. Requires staking separately via xpr_stake_validator.',
    parameters: {
      type: 'object',
      required: ['method', 'specializations'],
      properties: {
        method: { type: 'string', description: 'Validation method description' },
        specializations: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of specialization areas (e.g., ["code-review", "data-analysis"])',
        },
      },
    },
    handler: async ({ method, specializations }: { method: string; specializations: string[] }) => {
      validateRequired(method, 'method');
      const registry = new ValidationRegistry(config.rpc, config.session, contracts.agentvalid);
      return registry.registerValidator(method, specializations);
    },
  });

  api.registerTool({
    name: 'xpr_submit_validation',
    description: 'Submit a validation result for an agent\'s job output.',
    parameters: {
      type: 'object',
      required: ['agent', 'job_hash', 'result', 'confidence'],
      properties: {
        agent: { type: 'string', description: 'Agent account being validated' },
        job_hash: { type: 'string', description: 'Hash of the job being validated' },
        result: { type: 'string', enum: ['fail', 'pass', 'partial'], description: 'Validation result' },
        confidence: { type: 'number', description: 'Confidence level 0-100' },
        evidence_uri: { type: 'string', description: 'URI to validation evidence' },
        fee_amount: { type: 'number', description: 'Validation fee in XPR' },
      },
    },
    handler: async (params: {
      agent: string;
      job_hash: string;
      result: string;
      confidence: number;
      evidence_uri?: string;
      fee_amount?: number;
    }) => {
      validateAccountName(params.agent, 'agent');
      validateRequired(params.job_hash, 'job_hash');
      validateValidationResult(params.result);
      validateConfidence(params.confidence);
      if (params.fee_amount) {
        validateAmount(Math.floor(params.fee_amount * 10000), config.maxTransferAmount);
      }

      const registry = new ValidationRegistry(config.rpc, config.session, contracts.agentvalid);
      const data = {
        agent: params.agent,
        job_hash: params.job_hash,
        result: params.result as ValidationResult,
        confidence: params.confidence,
        evidence_uri: params.evidence_uri,
      };

      if (params.fee_amount) {
        return registry.validateWithFee(data, `${params.fee_amount.toFixed(4)} XPR`);
      }
      return registry.validate(data);
    },
  });

  api.registerTool({
    name: 'xpr_challenge_validation',
    description: 'Challenge a validation result. Must be funded separately via token transfer with memo "challenge:CHALLENGE_ID".',
    parameters: {
      type: 'object',
      required: ['validation_id', 'reason'],
      properties: {
        validation_id: { type: 'number', description: 'ID of the validation to challenge' },
        reason: { type: 'string', description: 'Reason for the challenge' },
        evidence_uri: { type: 'string', description: 'URI to supporting evidence' },
      },
    },
    handler: async ({ validation_id, reason, evidence_uri }: {
      validation_id: number;
      reason: string;
      evidence_uri?: string;
    }) => {
      validatePositiveInt(validation_id, 'validation_id');
      validateRequired(reason, 'reason');

      const registry = new ValidationRegistry(config.rpc, config.session, contracts.agentvalid);
      return registry.challenge(validation_id, reason, evidence_uri);
    },
  });

  api.registerTool({
    name: 'xpr_stake_validator',
    description: 'Stake XPR as a validator. Staked tokens are slashable if validations are successfully challenged.',
    parameters: {
      type: 'object',
      required: ['amount'],
      properties: {
        amount: { type: 'number', description: 'Amount to stake in XPR (e.g., 1000.0)' },
        confirmed: { type: 'boolean', description: 'Set to true to execute after reviewing the confirmation prompt' },
      },
    },
    handler: async ({ amount, confirmed }: { amount: number; confirmed?: boolean }) => {
      if (amount <= 0) throw new Error('amount must be positive');
      validateAmount(Math.floor(amount * 10000), config.maxTransferAmount);

      const confirmation = needsConfirmation(
        config.confirmHighRisk,
        confirmed,
        'Stake Validator',
        { amount: `${amount} XPR`, note: 'Staked tokens are slashable' },
        `Stake ${amount} XPR as validator collateral (slashable if challenged successfully)`
      );
      if (confirmation) return confirmation;

      const registry = new ValidationRegistry(config.rpc, config.session, contracts.agentvalid);
      return registry.stake(`${amount.toFixed(4)} XPR`);
    },
  });
}
