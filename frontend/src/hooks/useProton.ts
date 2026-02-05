import { useState, useEffect, useCallback, useRef } from 'react';
import ProtonWebSDK from '@proton/web-sdk';
import type { LinkSession } from '@proton/link';

interface Session {
  auth: {
    actor: string;
    permission: string;
  };
  linkSession: LinkSession;
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

// Module-level singleton to track if SDK has been initialized
let sdkInitialized = false;

export function useProton(): ProtonHook {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkRef = useRef<any>(null);

  // Restore session on mount
  useEffect(() => {
    // Only restore once across all hook instances
    if (sdkInitialized) return;
    sdkInitialized = true;

    const restoreSession = async () => {
      try {
        setLoading(true);
        const { link, session: restoredSession } = await ProtonWebSDK({
          linkOptions: {
            chainId: CHAIN_ID,
            endpoints: ENDPOINTS,
            restoreSession: true,
          },
          transportOptions: {
            requestAccount: APP_NAME,
          },
          selectorOptions: {
            appName: APP_NAME,
          },
        });

        if (link) {
          linkRef.current = link;
        }

        if (restoredSession) {
          setSession({
            auth: {
              actor: restoredSession.auth.actor.toString(),
              permission: restoredSession.auth.permission.toString(),
            },
            linkSession: restoredSession,
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
      const { link, session: newSession } = await ProtonWebSDK({
        linkOptions: {
          chainId: CHAIN_ID,
          endpoints: ENDPOINTS,
        },
        transportOptions: {
          requestAccount: APP_NAME,
        },
        selectorOptions: {
          appName: APP_NAME,
        },
      });

      if (link) {
        linkRef.current = link;
      }

      if (newSession) {
        setSession({
          auth: {
            actor: newSession.auth.actor.toString(),
            permission: newSession.auth.permission.toString(),
          },
          linkSession: newSession,
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
      try {
        await linkRef.current.removeSession(APP_NAME, session.auth, CHAIN_ID);
      } catch (e) {
        console.log('Error removing session:', e);
      }
      setSession(null);
      sdkInitialized = false; // Allow re-init on next mount
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

  return {
    session,
    loading,
    error,
    login,
    logout,
    transact,
  };
}
