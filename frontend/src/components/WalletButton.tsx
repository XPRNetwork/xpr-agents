import { useProton } from '@/hooks/useProton';

export function WalletButton() {
  const { session, loading, login, logout } = useProton();

  if (loading) {
    return (
      <button
        disabled
        className="px-4 py-2 bg-zinc-800 text-zinc-500 rounded-lg cursor-not-allowed"
      >
        Loading...
      </button>
    );
  }

  if (session) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-400">{session.auth.actor}</span>
        <button
          onClick={logout}
          className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg hover:bg-zinc-700 transition-colors"
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className="px-4 py-2 bg-proton-purple text-white rounded-lg hover:bg-purple-700 transition-colors"
    >
      Connect Wallet
    </button>
  );
}
