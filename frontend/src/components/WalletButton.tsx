import { useProton } from '@/hooks/useProton';

export function WalletButton() {
  const { session, loading, login, logout } = useProton();

  if (loading) {
    return (
      <button
        disabled
        className="px-4 py-2 bg-surface-2 text-muted rounded-lg cursor-not-allowed"
      >
        Loading...
      </button>
    );
  }

  if (session) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-2">{session.auth.actor}</span>
        <button
          onClick={logout}
          className="px-4 py-2 bg-surface-2 text-ink-2 rounded-lg hover:bg-line transition-colors"
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
    >
      Connect Wallet
    </button>
  );
}
