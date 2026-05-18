import { LlmClient, LlmProvider, detectProviderFromKey } from './types';

/**
 * Build an LLM client from env. Resolves provider, model, and API key in
 * this priority order:
 *
 *   1. Explicit args (passed by the runner's launch code)
 *   2. AGENT_LLM_PROVIDER env var
 *   3. Detect from API key prefix (sk-ant-… → anthropic, xai-… → xai, …)
 *
 * The API key is picked from the provider-specific env var
 * (ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY / GEMINI_API_KEY) if set,
 * otherwise from the generic ANTHROPIC_API_KEY for back-compat with the
 * pre-multi-provider config.
 *
 * Model picks from AGENT_MODEL (legacy / shared) first, then
 * AGENT_MODEL_<PROVIDER>, then the provider's hardcoded default.
 */
export function createLlmClientFromEnv(opts?: {
  provider?: LlmProvider;
  apiKey?: string;
  model?: string;
}): LlmClient {
  let provider: LlmProvider | null = opts?.provider || null;
  if (!provider) {
    const envProvider = (process.env.AGENT_LLM_PROVIDER || '').toLowerCase();
    if (envProvider === 'anthropic' || envProvider === 'openai' || envProvider === 'xai' || envProvider === 'gemini') {
      provider = envProvider;
    }
  }

  // Pull the per-provider key from env (preferred), then fall back to
  // ANTHROPIC_API_KEY for back-compat with single-provider setups.
  const providerKeyEnv: Record<LlmProvider, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    xai: 'XAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
  };

  let apiKey = opts?.apiKey || '';

  // If we still don't have a provider, try to detect from any key we have.
  if (!provider) {
    if (apiKey) {
      provider = detectProviderFromKey(apiKey);
    }
    if (!provider) {
      // Last-resort: scan all provider-specific env vars and pick whichever is set.
      for (const p of ['anthropic', 'openai', 'xai', 'gemini'] as LlmProvider[]) {
        if (process.env[providerKeyEnv[p]]) {
          provider = p;
          break;
        }
      }
    }
  }

  if (!provider) provider = 'anthropic'; // ultimate fallback for back-compat

  // Pick the API key for the resolved provider.
  if (!apiKey) {
    apiKey = process.env[providerKeyEnv[provider]] || '';
    if (!apiKey && provider === 'anthropic') {
      apiKey = process.env.ANTHROPIC_API_KEY || '';
    }
  }

  if (!apiKey) {
    throw new Error(
      `[llm] No API key found for provider '${provider}'. Set ${providerKeyEnv[provider]} or pass --api-key on the CLI.`,
    );
  }

  // Resolve model. AGENT_MODEL (legacy) wins; then AGENT_MODEL_<PROVIDER>; then default.
  let model = opts?.model;
  if (!model) {
    model = process.env.AGENT_MODEL
      || process.env[`AGENT_MODEL_${provider.toUpperCase()}`]
      || undefined;
  }

  // Lazy-load the impl so we don't pay the cost of importing all SDKs at boot.
  switch (provider) {
    case 'anthropic': {
      const { AnthropicLlmClient } = require('./anthropic');
      return new AnthropicLlmClient({ apiKey, model });
    }
    case 'openai': {
      const { OpenAiLlmClient } = require('./openai');
      return new OpenAiLlmClient({ apiKey, model });
    }
    case 'xai': {
      const { XaiLlmClient } = require('./openai');
      return new XaiLlmClient({ apiKey, model });
    }
    case 'gemini': {
      const { GeminiLlmClient } = require('./gemini');
      return new GeminiLlmClient({ apiKey, model });
    }
  }
}
