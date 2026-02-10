import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

interface Session {
  auth: {
    actor: string;
    permission: string;
  };
  link: any;
  linkSession: any;
}

interface ProtonContextType {
  session: Session | null;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  transact: (actions: any[]) => Promise<any>;
}

const ProtonContext = createContext<ProtonContextType | null>(null);

const APP_NAME = 'XPR Agents';
// requestAccount must be a valid on-chain account — shown as requestor in wallet
const REQUEST_ACCOUNT = process.env.NEXT_PUBLIC_REQUEST_ACCOUNT || 'agentcore';

// Network config — default to testnet; set NEXT_PUBLIC_NETWORK=mainnet for production
const isMainnet = process.env.NEXT_PUBLIC_NETWORK === 'mainnet';
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || (isMainnet
  ? '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0'
  : '71ee83bcf20daefb060b14f72ad1dab3f84b588d12b4571f9b662a13a6f61f82');
const ENDPOINTS = [process.env.NEXT_PUBLIC_RPC_URL || (isMainnet
  ? 'https://proton.eosusa.io'
  : 'https://tn1.protonnz.com')];

// Module-level flags survive React StrictMode remounts (refs don't)
let sessionRestoreStarted = false;
let loginInProgress = false;

export function ProtonProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restore session on mount
  useEffect(() => {
    if (sessionRestoreStarted) return;
    sessionRestoreStarted = true;

    (async () => {
      try {
        const { default: ProtonWebSDK } = await import('@proton/web-sdk');

        const { link, session: restored } = await ProtonWebSDK({
          linkOptions: {
            chainId: CHAIN_ID,
            endpoints: ENDPOINTS,
            restoreSession: true,
          },
          transportOptions: {
            requestAccount: REQUEST_ACCOUNT,
          },
          selectorOptions: {
            appName: APP_NAME,
          },
        });

        if (restored) {
          setSession({
            auth: {
              actor: restored.auth.actor.toString(),
              permission: restored.auth.permission.toString(),
            },
            link,
            linkSession: restored,
          });
        }
      } catch (e: any) {
        console.warn('Session restore failed:', e?.message || e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async () => {
    if (loginInProgress) return;
    loginInProgress = true;

    setLoading(true);
    setError(null);

    try {
      const { default: ProtonWebSDK } = await import('@proton/web-sdk');

      // Fresh ProtonWebSDK call WITHOUT restoreSession — shows wallet selector
      const { link, session: loginSession } = await ProtonWebSDK({
        linkOptions: {
          chainId: CHAIN_ID,
          endpoints: ENDPOINTS,
        },
        transportOptions: {
          requestAccount: REQUEST_ACCOUNT,
        },
        selectorOptions: {
          appName: APP_NAME,
        },
      });

      if (loginSession) {
        setSession({
          auth: {
            actor: loginSession.auth.actor.toString(),
            permission: loginSession.auth.permission.toString(),
          },
          link,
          linkSession: loginSession,
        });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to login');
    } finally {
      loginInProgress = false;
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (session?.link) {
      try {
        await session.link.removeSession(REQUEST_ACCOUNT, session.auth, CHAIN_ID);
      } catch (e) {
        console.log('Error removing session:', e);
      }
    }
    setSession(null);
  }, [session]);

  const transact = useCallback(
    async (actions: any[]) => {
      if (!session) {
        throw new Error('No active session');
      }

      try {
        const result = await session.linkSession.transact(
          {
            actions: actions.map((action) => ({
              ...action,
              authorization: [
                {
                  actor: session.auth.actor,
                  permission: session.auth.permission,
                },
              ],
            })),
          },
          {
            broadcast: true,
          }
        );

        return result;
      } catch (e: any) {
        throw new Error(e.message || 'Transaction failed');
      }
    },
    [session]
  );

  return (
    <ProtonContext.Provider value={{ session, loading, error, login, logout, transact }}>
      {children}
    </ProtonContext.Provider>
  );
}

export function useProton(): ProtonContextType {
  const context = useContext(ProtonContext);
  if (!context) {
    throw new Error('useProton must be used within a ProtonProvider');
  }
  return context;
}
