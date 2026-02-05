import { useState, useEffect, useCallback, useRef } from 'react';
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

// Module-level singleton for the SDK link - shared across all hook instances
let sharedLink: any = null;
let initPromise: Promise<any> | null = null;

/**
 * Initialize SDK once and cache the link for reuse.
 * If restoreSession is true, attempts to restore existing session.
 */
async function initSDK(restoreSession: boolean): Promise<{ link: any; session: LinkSession | null }> {
  // If we already have a link and don't need to restore, return it
  if (sharedLink && !restoreSession) {
    return { link: sharedLink, session: null };
  }

  // If initialization is in progress, wait for it
  if (initPromise) {
    const result = await initPromise;
    return { link: sharedLink, session: restoreSession ? result.session : null };
  }

  // Dynamically import ProtonWebSDK to avoid SSR/ESM issues in Next.js
  // The library uses browser-only APIs that break during server-side rendering
  const { default: ProtonWebSDK } = await import('@proton/web-sdk');

  // Initialize SDK - this only happens once
  initPromise = ProtonWebSDK({
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
  });

  const result = await initPromise;

  if (result.link) {
    sharedLink = result.link;
  }

  initPromise = null;

  return { link: sharedLink, session: result.session || null };
}

export function useProton(): ProtonHook {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  // Restore session on mount - only once per app lifecycle
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const restoreSession = async () => {
      try {
        setLoading(true);
        const { link, session: restoredSession } = await initSDK(true);

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
      // Get the shared link (or initialize if needed)
      const { link } = await initSDK(false);

      if (!link) {
        throw new Error('Failed to initialize wallet connection');
      }

      // Use the shared link to trigger login
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

  return {
    session,
    loading,
    error,
    login,
    logout,
    transact,
  };
}
