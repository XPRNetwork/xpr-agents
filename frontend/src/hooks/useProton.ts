import { useState, useEffect, useCallback } from 'react';
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

export function useProton(): ProtonHook {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<ProtonWebLink | null>(null);

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        setLoading(true);
        const { link, session } = await ProtonWebSDK({
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

        setLink(link);

        if (session) {
          setSession({
            auth: {
              actor: session.auth.actor.toString(),
              permission: session.auth.permission.toString(),
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
      const { link, session } = await ProtonWebSDK({
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

      setLink(link);

      if (session) {
        setSession({
          auth: {
            actor: session.auth.actor.toString(),
            permission: session.auth.permission.toString(),
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
    if (link && session) {
      await link.removeSession(APP_NAME, session.auth as any, CHAIN_ID);
      setSession(null);
    }
  }, [link, session]);

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
