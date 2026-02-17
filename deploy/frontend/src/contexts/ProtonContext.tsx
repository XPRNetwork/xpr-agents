import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getNetworkConfig } from '@/lib/networks';
import { loginWithProof } from '@/lib/deploy-api';

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
  verifying: boolean;
  error: string | null;
  jwtToken: string | null;
  authenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  transact: (actions: any[]) => Promise<any>;
}

const ProtonContext = createContext<ProtonContextType | null>(null);

const APP_NAME = 'XPR Agent Deploy';
const REQUEST_ACCOUNT = process.env.NEXT_PUBLIC_REQUEST_ACCOUNT || 'agentdeploy';
const JWT_STORAGE_KEY = 'xpr_deploy_jwt';

const networkConfig = getNetworkConfig();
const CHAIN_ID = networkConfig.chainId;
const ENDPOINTS = [networkConfig.rpc];

let sessionRestoreStarted = false;
let loginInProgress = false;
let verifyInProgress = false;

/**
 * Check if a JWT is expired by decoding the payload.
 */
function isJwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

/**
 * Convert a Uint8Array to hex string (browser-safe, no Buffer dependency).
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sign a non-broadcast transaction to prove wallet ownership, then exchange
 * the signature for a JWT via POST /api/auth/login.
 *
 * Uses linkSession.transact({ broadcast: false }) which shows a WebAuth
 * biometric popup but does NOT send the transaction on-chain.
 */
/**
 * Authenticate returns the JWT token on success, or throws an Error with
 * a user-facing message on failure. Callers should catch and display the error.
 */
async function authenticate(
  linkSession: any,
  actor: string,
  permission: string,
): Promise<string> {
  if (verifyInProgress) throw new Error('Verification already in progress');
  verifyInProgress = true;

  try {
    console.log('[auth] Requesting signature proof from wallet...');

    // Sign a generateauth action with broadcast: false — wallet shows biometric
    // popup, user approves, we get the signature without any on-chain effect.
    // generateauth is a no-op action that proves identity without transferring tokens.
    let result: any;
    try {
      result = await linkSession.transact(
        {
          actions: [
            {
              account: 'proton.wrap',
              name: 'generateauth',
              authorization: [{ actor, permission }],
              data: {
                protonAccount: actor,
                time: new Date().toISOString().slice(0, -1), // time_point format
              },
            },
          ],
        },
        { broadcast: false },
      );
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('cancel') || msg.includes('rejected') || msg.includes('denied')) {
        throw new Error('Signature request was cancelled. You must approve to verify your identity.');
      }
      throw new Error(`Wallet signing failed: ${msg}`);
    }

    // Extract serialized transaction — try multiple paths
    const rawTx = result?.serializedTransaction
      || result?.resolved?.serializedTransaction;

    // Extract signatures — try multiple paths
    const rawSigs = result?.signatures
      || result?.resolved?.signatures;

    if (!rawTx || !rawSigs?.length) {
      console.error('[auth] Missing data. Result keys:', Object.keys(result || {}));
      throw new Error('Wallet returned an incomplete signature. Check browser console for details.');
    }

    // Handle both hex string and Uint8Array formats
    let serializedTransaction: string;
    if (typeof rawTx === 'string') {
      serializedTransaction = rawTx;
    } else {
      serializedTransaction = toHex(rawTx instanceof Uint8Array ? rawTx : new Uint8Array(rawTx));
    }
    const signatures = rawSigs.map((s: any) => typeof s === 'string' ? s : s.toString());

    console.log('[auth] Sending to backend:', {
      account: actor,
      chainId: CHAIN_ID,
      serializedTransaction: serializedTransaction.substring(0, 40) + '...',
      signatureCount: signatures.length,
      signaturePrefix: signatures[0]?.substring(0, 20),
    });

    let response: any;
    try {
      response = await loginWithProof({
        account: actor,
        chainId: CHAIN_ID,
        serializedTransaction,
        signatures,
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      throw new Error(`Server verification failed: ${msg}`);
    }

    if (!response.token) {
      throw new Error('Server did not return an authentication token.');
    }

    console.log('[auth] JWT issued, identity verified');
    localStorage.setItem(JWT_STORAGE_KEY, response.token);
    return response.token;
  } finally {
    verifyInProgress = false;
  }
}

export function ProtonProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jwtToken, setJwtToken] = useState<string | null>(null);

  // Restore session + JWT on mount
  useEffect(() => {
    if (sessionRestoreStarted) return;
    sessionRestoreStarted = true;

    (async () => {
      try {
        const { default: ProtonWebSDK } = await import('@proton/web-sdk');
        const { link, session: restored } = await ProtonWebSDK({
          linkOptions: { chainId: CHAIN_ID, endpoints: ENDPOINTS, restoreSession: true },
          transportOptions: { requestAccount: REQUEST_ACCOUNT },
          selectorOptions: { appName: APP_NAME },
        });

        if (restored) {
          const actor = restored.auth.actor.toString();
          const permission = restored.auth.permission.toString();

          // Check for existing JWT in localStorage
          const storedJwt = localStorage.getItem(JWT_STORAGE_KEY);
          if (storedJwt && !isJwtExpired(storedJwt)) {
            // Valid JWT exists — restore full session
            setSession({ auth: { actor, permission }, link, linkSession: restored });
            setJwtToken(storedJwt);
          } else {
            // JWT missing or expired — re-authenticate (biometric popup)
            if (storedJwt) localStorage.removeItem(JWT_STORAGE_KEY);
            try {
              const newToken = await authenticate(restored, actor, permission);
              setSession({ auth: { actor, permission }, link, linkSession: restored });
              setJwtToken(newToken);
            } catch (e: any) {
              console.warn('[auth] Session restore auth failed:', e?.message);
              // Can't verify — clear the wallet session
              try { if (link) await link.removeSession(REQUEST_ACCOUNT, restored.auth, CHAIN_ID); } catch {}
            }
          }
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
      const { link, session: loginSession } = await ProtonWebSDK({
        linkOptions: { chainId: CHAIN_ID, endpoints: ENDPOINTS },
        transportOptions: { requestAccount: REQUEST_ACCOUNT },
        selectorOptions: { appName: APP_NAME },
      });

      if (loginSession) {
        const actor = loginSession.auth.actor.toString();
        const permission = loginSession.auth.permission.toString();

        // Verify identity via signed transaction BEFORE setting session
        // This ensures the user can't appear "logged in" without proving key ownership
        setVerifying(true);
        try {
          const token = await authenticate(loginSession, actor, permission);
          setSession({ auth: { actor, permission }, link, linkSession: loginSession });
          setJwtToken(token);
        } catch (authErr: any) {
          // Auth failed — disconnect the wallet session, don't leave half-connected
          try { if (link) await link.removeSession(REQUEST_ACCOUNT, loginSession.auth, CHAIN_ID); } catch {}
          setError(authErr.message || 'Identity verification failed.');
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to login');
    } finally {
      loginInProgress = false;
      setLoading(false);
      setVerifying(false);
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
    setJwtToken(null);
    localStorage.removeItem(JWT_STORAGE_KEY);
  }, [session]);

  const transact = useCallback(
    async (actions: any[]) => {
      if (!session) throw new Error('No active session');
      const result = await session.linkSession.transact(
        {
          actions: actions.map((action) => ({
            ...action,
            authorization: [{ actor: session.auth.actor, permission: session.auth.permission }],
          })),
        },
        { broadcast: true },
      );
      return result;
    },
    [session],
  );

  return (
    <ProtonContext.Provider value={{ session, loading, verifying, error, jwtToken, authenticated: !!jwtToken, login, logout, transact }}>
      {children}
    </ProtonContext.Provider>
  );
}

export function useProton(): ProtonContextType {
  const context = useContext(ProtonContext);
  if (!context) throw new Error('useProton must be used within a ProtonProvider');
  return context;
}
