import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { LinkSession } from '@proton/link';

interface Session {
  auth: {
    actor: string;
    permission: string;
  };
  linkSession: LinkSession;
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

// Network config — default to testnet; set NEXT_PUBLIC_NETWORK=mainnet for production
const isMainnet = process.env.NEXT_PUBLIC_NETWORK === 'mainnet';
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || (isMainnet
  ? '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0'
  : '71ee83bcf20daefb060b14f72ad1dab3f84b588d12b4571f9b662a13a6f61f82');
const ENDPOINTS = [process.env.NEXT_PUBLIC_RPC_URL || (isMainnet
  ? 'https://proton.eosusa.io'
  : 'https://tn1.protonnz.com')];

let sharedLink: any = null;
let initPromise: Promise<any> | null = null;

async function initSDK(restoreSession: boolean): Promise<{ link: any; session: LinkSession | null }> {
  if (sharedLink && !restoreSession) {
    return { link: sharedLink, session: null };
  }

  // If already initializing with restore, wait for it
  if (initPromise && restoreSession) {
    const result = await initPromise;
    return { link: sharedLink, session: result.session || null };
  }
  if (initPromise) {
    await initPromise;
    return { link: sharedLink, session: null };
  }

  const { default: ProtonWebSDK } = await import('@proton/web-sdk');

  initPromise = ProtonWebSDK({
    linkOptions: {
      chainId: CHAIN_ID,
      endpoints: ENDPOINTS,
      restoreSession,
      storage: typeof window !== 'undefined' ? window.localStorage as any : undefined,
    },
    transportOptions: {
      requestAccount: APP_NAME,
    },
    selectorOptions: {
      appName: APP_NAME,
    },
  });

  const result = await initPromise;

  if (result.link) {
    sharedLink = result.link;
  }

  initPromise = null;

  return { link: sharedLink, session: result.session || null };
}

export function ProtonProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const restoreSession = async () => {
      try {
        const { session: restoredSession } = await initSDK(true);

        if (restoredSession) {
          setSession({
            auth: {
              actor: restoredSession.auth.actor.toString(),
              permission: restoredSession.auth.permission.toString(),
            },
            linkSession: restoredSession,
          });
        }
      } catch (e: any) {
        console.warn('Session restore failed:', e?.message || e);
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const login = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { link } = await initSDK(false);

      if (!link) {
        throw new Error('Failed to initialize wallet connection');
      }

      const loginResult = await link.login(APP_NAME);

      if (loginResult?.session) {
        setSession({
          auth: {
            actor: loginResult.session.auth.actor.toString(),
            permission: loginResult.session.auth.permission.toString(),
          },
          linkSession: loginResult.session,
        });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to login');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (sharedLink && session) {
      try {
        await sharedLink.removeSession(APP_NAME, session.auth, CHAIN_ID);
      } catch (e) {
        console.log('Error removing session:', e);
      }
      setSession(null);
    }
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
