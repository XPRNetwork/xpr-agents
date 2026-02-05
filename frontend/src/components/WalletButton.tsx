import { useProton } from '@/hooks/useProton';

export function WalletButton() {
  const { session, loading, login, logout } = useProton();

  if (loading) {
    return (
      <button
        disabled
        className="px-4 py-2 bg-gray-200 text-gray-500 rounded-lg cursor-not-allowed"
      >
        Loading...
      </button>
    );
  }

  if (session) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600">{session.auth.actor}</span>
        <button
          onClick={logout}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
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
