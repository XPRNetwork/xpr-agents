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
  error: string | null;
  jwtToken: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  transact: (actions: any[]) => Promise<any>;
}

const ProtonContext = createContext<ProtonContextType | null>(null);

const APP_NAME = 'XPR Agent Deploy';
const REQUEST_ACCOUNT = process.env.NEXT_PUBLIC_REQUEST_ACCOUNT || 'agentcore';
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
async function authenticate(
  linkSession: any,
  actor: string,
  permission: string,
): Promise<string | null> {
  if (verifyInProgress) return null;
  verifyInProgress = true;

  try {
    // Sign a self-transfer with broadcast: false — wallet shows biometric
    // popup, user approves, we get the signature without any on-chain effect
    const result = await linkSession.transact(
      {
        actions: [
          {
            account: 'eosio.token',
            name: 'transfer',
            authorization: [{ actor, permission }],
            data: {
              from: actor,
              to: actor,
              quantity: '0.0001 XPR',
              memo: `auth:${Math.floor(Date.now() / 1000)}`,
            },
          },
        ],
      },
      { broadcast: false },
    );

    // Extract the signed transaction bytes and signature
    const serializedTransaction = toHex(
      new Uint8Array(result.resolved.serializedTransaction),
    );
    const signatures = result.signatures.map(String);

    const response = await loginWithProof({
      account: actor,
      chainId: CHAIN_ID,
      serializedTransaction,
      signatures,
    });

    if (response.token) {
      localStorage.setItem(JWT_STORAGE_KEY, response.token);
      return response.token;
    }
    return null;
  } catch (e: any) {
    console.warn('[auth] Wallet verification failed:', e?.message || e);
    return null;
  } finally {
    verifyInProgress = false;
  }
}

export function ProtonProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
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

          setSession({ auth: { actor, permission }, link, linkSession: restored });

          // Check for existing JWT in localStorage
          const storedJwt = localStorage.getItem(JWT_STORAGE_KEY);
          if (storedJwt && !isJwtExpired(storedJwt)) {
            setJwtToken(storedJwt);
          } else {
            // JWT missing or expired — re-authenticate (biometric popup)
            if (storedJwt) localStorage.removeItem(JWT_STORAGE_KEY);
            const newToken = await authenticate(restored, actor, permission);
            if (newToken) setJwtToken(newToken);
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

        setSession({ auth: { actor, permission }, link, linkSession: loginSession });

        // Immediately verify identity for JWT after wallet connect
        const token = await authenticate(loginSession, actor, permission);
        if (token) setJwtToken(token);
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
    <ProtonContext.Provider value={{ session, loading, error, jwtToken, login, logout, transact }}>
      {children}
    </ProtonContext.Provider>
  );
}

export function useProton(): ProtonContextType {
  const context = useContext(ProtonContext);
  if (!context) throw new Error('useProton must be used within a ProtonProvider');
  return context;
}
