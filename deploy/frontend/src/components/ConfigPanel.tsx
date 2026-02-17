import { useState } from 'react';
import { updateAgentConfig } from '@/lib/deploy-api';

interface ConfigPanelProps {
  agent: string;
  token: string;
  onSaved?: () => void;
}

interface FieldState {
  value: string;
  saving: boolean;
  success: boolean;
  error: string;
}

const INITIAL_FIELD: FieldState = { value: '', saving: false, success: false, error: '' };

export function ConfigPanel({ agent, token, onSaved }: ConfigPanelProps) {
  const [anthropicApiKey, setAnthropicApiKey] = useState<FieldState>({ ...INITIAL_FIELD });
  const [telegramToken, setTelegramToken] = useState<FieldState>({ ...INITIAL_FIELD });
  const [discordToken, setDiscordToken] = useState<FieldState>({ ...INITIAL_FIELD });
  const [slackToken, setSlackToken] = useState<FieldState>({ ...INITIAL_FIELD });

  const handleUpdate = async (
    fieldName: string,
    state: FieldState,
    setState: React.Dispatch<React.SetStateAction<FieldState>>
  ) => {
    if (!state.value.trim()) return;

    setState((prev) => ({ ...prev, saving: true, success: false, error: '' }));

    try {
      await updateAgentConfig(agent, { [fieldName]: state.value.trim() }, token);
      setState((prev) => ({ ...prev, saving: false, success: true, value: '' }));
      onSaved?.();

      // Clear success after 3 seconds
      setTimeout(() => {
        setState((prev) => ({ ...prev, success: false }));
      }, 3000);
    } catch (e: any) {
      setState((prev) => ({
        ...prev,
        saving: false,
        error: e.message || 'Update failed',
      }));
    }
  };

  const renderField = (
    label: string,
    fieldName: string,
    placeholder: string,
    state: FieldState,
    setState: React.Dispatch<React.SetStateAction<FieldState>>,
    helpText?: React.ReactNode
  ) => (
    <div className="mb-5">
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input
          type="password"
          className="input flex-1"
          placeholder={placeholder}
          value={state.value}
          onChange={(e) => setState((prev) => ({ ...prev, value: e.target.value, error: '', success: false }))}
          disabled={state.saving}
        />
        <button
          onClick={() => handleUpdate(fieldName, state, setState)}
          disabled={state.saving || !state.value.trim()}
          className="btn-primary px-4 whitespace-nowrap"
        >
          {state.saving ? (
            <span className="flex items-center gap-1.5">
              <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
              Saving
            </span>
          ) : (
            'Update'
          )}
        </button>
      </div>
      {helpText && <p className="text-xs text-gray-500 mt-1">{helpText}</p>}
      {state.success && (
        <p className="text-xs text-green-400 mt-1">Updated successfully.</p>
      )}
      {state.error && (
        <p className="text-xs text-red-400 mt-1">{state.error}</p>
      )}
    </div>
  );

  return (
    <div>
      <div className="bg-xpr-dark rounded-lg p-3 mb-5 text-sm text-gray-400 border border-xpr-border">
        Updates take effect immediately. Only fill in fields you want to change.
      </div>

      {/* API Key Section */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">API Key</h3>
        {renderField(
          'Anthropic API Key',
          'anthropicApiKey',
          'sk-ant-...',
          anthropicApiKey,
          setAnthropicApiKey,
          <>
            Your key is encrypted and only used to power your agent.{' '}
            <a
              href="https://console.anthropic.com/"
              target="_blank"
              rel="noopener"
              className="text-xpr-purple hover:underline"
            >
              Get a key
            </a>
          </>
        )}
      </div>

      {/* Telegram Section */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Telegram</h3>
        {renderField(
          'Bot Token',
          'telegramToken',
          '123456:ABC-...',
          telegramToken,
          setTelegramToken,
          <>
            Create a bot via{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener"
              className="text-xpr-purple hover:underline"
            >
              @BotFather
            </a>
          </>
        )}
      </div>

      {/* Discord Section */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Discord</h3>
        {renderField(
          'Bot Token',
          'discordToken',
          'MTE...',
          discordToken,
          setDiscordToken,
          'Create a bot in the Discord Developer Portal.'
        )}
      </div>

      {/* Slack Section */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Slack</h3>
        {renderField(
          'Bot Token',
          'slackToken',
          'xoxb-...',
          slackToken,
          setSlackToken,
          'Create a Slack app and install it to your workspace.'
        )}
      </div>
    </div>
  );
}
