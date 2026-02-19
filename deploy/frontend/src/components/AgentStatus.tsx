import { useState } from 'react';
import { getAgentLogs } from '@/lib/deploy-api';

interface AgentStatusProps {
  deployment: {
    agent_account: string;
    owner: string;
    endpoint: string;
    plan: string;
    status: string;
    created_at: string;
  };
  subscription?: {
    paid_until: number;
    state: number;
    token_symbol: string;
    total_paid: number;
  } | null;
  token?: string;
  onStatusChange?: () => void;
}

const STATE_LABELS: Record<number, string> = {
  0: 'Active',
  1: 'Grace Period',
  2: 'Paused',
  3: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  paused: 'bg-yellow-500',
  provisioning: 'bg-blue-500',
  cancelled: 'bg-red-500',
  cleanup: 'bg-gray-500',
};

export function AgentStatus({ deployment, subscription, token, onStatusChange }: AgentStatusProps) {
  const [actionLoading, setActionLoading] = useState('');
  const [actionError, setActionError] = useState('');
  const [logs, setLogs] = useState<any[] | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const paidUntilDate = subscription?.paid_until
    ? new Date(subscription.paid_until * 1000).toLocaleDateString()
    : null;

  const isExpired = subscription?.paid_until
    ? subscription.paid_until * 1000 < Date.now()
    : false;

  const handleLogs = async () => {
    if (!token) return;
    if (showLogs) {
      setShowLogs(false);
      return;
    }
    setActionLoading('logs');
    setActionError('');
    try {
      const result = await getAgentLogs(deployment.agent_account, token);
      setLogs(result.logs || []);
      setShowLogs(true);
    } catch (e: any) {
      setActionError(e.message || 'Failed to fetch logs');
    } finally {
      setActionLoading('');
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold font-mono">{deployment.agent_account}</h3>
          <p className="text-sm text-gray-400">Owner: {deployment.owner}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[deployment.status] || 'bg-gray-500'}`} />
          <span className="text-sm capitalize">{deployment.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-400">Endpoint</span>
          <div className="font-mono text-xs mt-1 truncate">
            <a href={deployment.endpoint} target="_blank" rel="noopener" className="text-xpr-purple hover:underline">
              {deployment.endpoint}
            </a>
          </div>
        </div>

        <div>
          <span className="text-gray-400">Plan</span>
          <div className="mt-1 capitalize">{deployment.plan}</div>
        </div>

        {subscription && (
          <>
            <div>
              <span className="text-gray-400">Subscription</span>
              <div className={`mt-1 ${isExpired ? 'text-red-400' : 'text-green-400'}`}>
                {STATE_LABELS[subscription.state] || 'Unknown'}
              </div>
            </div>

            <div>
              <span className="text-gray-400">Paid Until</span>
              <div className={`mt-1 ${isExpired ? 'text-red-400' : ''}`}>
                {paidUntilDate || 'N/A'}
              </div>
            </div>
          </>
        )}

        <div>
          <span className="text-gray-400">Created</span>
          <div className="mt-1">{new Date(deployment.created_at).toLocaleDateString()}</div>
        </div>
      </div>

      {actionError && (
        <div className="text-xs text-red-400 mt-3">{actionError}</div>
      )}

      <div className="flex gap-2 mt-4 pt-4 border-t border-xpr-border">
        {token && (
          <button
            className="btn-secondary text-sm py-1 px-3"
            onClick={handleLogs}
            disabled={actionLoading === 'logs'}
          >
            {actionLoading === 'logs' ? 'Loading...' : showLogs ? 'Hide Logs' : 'View Logs'}
          </button>
        )}
        {!token && (
          <button className="btn-secondary text-sm py-1 px-3 opacity-50 cursor-not-allowed" disabled>
            View Logs
          </button>
        )}
        {isExpired && (
          <button className="btn-primary text-sm py-1 px-3">Renew</button>
        )}
      </div>

      {/* Logs panel */}
      {showLogs && logs && (
        <div className="mt-4 pt-4 border-t border-xpr-border">
          <h4 className="text-sm font-medium mb-2">Recent Logs</h4>
          <div className="bg-black/50 rounded-lg p-3 max-h-[300px] overflow-y-auto font-mono text-xs">
            {logs.length === 0 && (
              <div className="text-gray-500">No logs available</div>
            )}
            {logs.map((log: any, i: number) => (
              <div key={i} className="text-gray-300 whitespace-pre-wrap break-all mb-0.5">
                {typeof log === 'string' ? log : log.message || JSON.stringify(log)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
