import { useState, useEffect, useCallback, useRef } from 'react';
import ProtonWebSDK, { ProtonWebLink } from '@proton/web-sdk';

interface Session {
  auth: {
    actor: string;
    permission: string;
  };
  link: ProtonWebLink;
}

interface ProtonHook {
  session: Session | null;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  transact: (actions: any[]) => Promise<any>;
}

const APP_NAME = 'XPR Agents';
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0';
const ENDPOINTS = [process.env.NEXT_PUBLIC_RPC_URL || 'https://proton.eosusa.io'];

// Module-level singleton for the SDK link
let sdkLink: ProtonWebLink | null = null;
let sdkInitPromise: Promise<{ link: ProtonWebLink; session: any }> | null = null;

async function getOrCreateSDK(restoreSession: boolean = false): Promise<{ link: ProtonWebLink; session: any }> {
  // If we already have a link, return it (with null session for non-restore calls)
  if (sdkLink && !restoreSession) {
    return { link: sdkLink, session: null };
  }

  // If initialization is in progress, wait for it
  if (sdkInitPromise) {
    return sdkInitPromise;
  }

  // Initialize the SDK
  sdkInitPromise = ProtonWebSDK({
    linkOptions: {
      chainId: CHAIN_ID,
      endpoints: ENDPOINTS,
      restoreSession,
    },
    transportOptions: {
      requestAccount: APP_NAME,
    },
    selectorOptions: {
      appName: APP_NAME,
    },
  }).then((result) => {
    sdkLink = result.link;
    return result;
  }).finally(() => {
    // Clear the promise after completion so future calls can re-init if needed
    // (but keep sdkLink so we reuse the same instance)
    sdkInitPromise = null;
  });

  return sdkInitPromise;
}

export function useProton(): ProtonHook {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkRef = useRef<ProtonWebLink | null>(null);

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        setLoading(true);
        const { link, session: restoredSession } = await getOrCreateSDK(true);

        linkRef.current = link;

        if (restoredSession) {
          setSession({
            auth: {
              actor: restoredSession.auth.actor.toString(),
              permission: restoredSession.auth.permission.toString(),
            },
            link,
          });
        }
      } catch (e) {
        // No session to restore
        console.log('No session to restore');
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
      // Use the existing SDK link if available, or create a new one
      const { link } = await getOrCreateSDK(false);
      linkRef.current = link;

      // Trigger the login flow using the existing link
      const identityResult = await link.login(APP_NAME);

      if (identityResult && identityResult.session) {
        const newSession = identityResult.session;
        setSession({
          auth: {
            actor: newSession.auth.actor.toString(),
            permission: newSession.auth.permission.toString(),
          },
          link,
        });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to login');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (linkRef.current && session) {
      await linkRef.current.removeSession(APP_NAME, session.auth as any, CHAIN_ID);
      setSession(null);
    }
  }, [session]);

  const transact = useCallback(
    async (actions: any[]) => {
      if (!session) {
        throw new Error('No active session');
      }

      try {
        const result = await session.link.transact(
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

  return {
    session,
    loading,
    error,
    login,
    logout,
    transact,
  };
}
