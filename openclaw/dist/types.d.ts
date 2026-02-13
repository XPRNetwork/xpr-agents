/**
 * Internal types for the OpenClaw plugin.
 */
import type { JsonRpc, ProtonSession } from '@xpr-agents/sdk';
export interface PluginConfig {
    rpc: JsonRpc;
    session?: ProtonSession;
    network: 'mainnet' | 'testnet';
    rpcEndpoint: string;
    indexerUrl: string;
    contracts: ContractNames;
    confirmHighRisk: boolean;
    maxTransferAmount: number;
}
export interface ContractNames {
    agentcore: string;
    agentfeed: string;
    agentvalid: string;
    agentescrow: string;
}
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        required?: string[];
        properties: Record<string, unknown>;
    };
    handler: (params: any) => Promise<unknown>;
}
/**
 * OpenClaw plugin API interface.
 * This matches the OpenClaw extension registration pattern.
 */
export interface PluginApi {
    registerTool(tool: ToolDefinition): void;
    getConfig(): Record<string, unknown>;
}
//# sourceMappingURL=types.d.ts.map