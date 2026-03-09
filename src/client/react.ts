/**
 * React utilities for API token management.
 *
 * Usage:
 * ```tsx
 * import { useApiToken } from "convex-api-tokens/react";
 *
 * function App() {
 *   const { token, setToken, clearToken, headers } = useApiToken();
 *
 *   // After creating a token:
 *   setToken(result.token);
 *
 *   // For fetch requests:
 *   fetch("/api/data", { headers });
 *
 *   // To logout / clear:
 *   clearToken();
 * }
 * ```
 */

// Use dynamic require to avoid hard React dependency at import time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const React = require("react");

const STORAGE_KEY = "convex-api-token";

/**
 * React hook for managing an API token in the browser.
 * Stores the token in localStorage and provides helpers for auth headers.
 *
 * @param storageKey - Custom localStorage key (default: "convex-api-token")
 */
export function useApiToken(storageKey: string = STORAGE_KEY) {
  const [token, setTokenState] = React.useState(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(storageKey);
  });

  const setToken = React.useCallback(
    (newToken: string) => {
      localStorage.setItem(storageKey, newToken);
      setTokenState(newToken);
    },
    [storageKey]
  );

  const clearToken = React.useCallback(() => {
    localStorage.removeItem(storageKey);
    setTokenState(null);
  }, [storageKey]);

  const headers = React.useMemo(
    () =>
      token
        ? { Authorization: `Bearer ${token}` }
        : ({} as Record<string, string>),
    [token]
  );

  return {
    /** The current token, or null if not set */
    token: token as string | null,
    /** Store a new token (persists to localStorage) */
    setToken: setToken as (token: string) => void,
    /** Clear the stored token */
    clearToken: clearToken as () => void,
    /** Auth headers object: { Authorization: "Bearer <token>" } */
    headers: headers as Record<string, string>,
    /** Whether a token is currently stored */
    isAuthenticated: token !== null,
  };
}

/**
 * React hook for managing API tokens with session storage (cleared on tab close).
 */
export function useSessionApiToken(storageKey: string = STORAGE_KEY) {
  const [token, setTokenState] = React.useState(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(storageKey);
  });

  const setToken = React.useCallback(
    (newToken: string) => {
      sessionStorage.setItem(storageKey, newToken);
      setTokenState(newToken);
    },
    [storageKey]
  );

  const clearToken = React.useCallback(() => {
    sessionStorage.removeItem(storageKey);
    setTokenState(null);
  }, [storageKey]);

  const headers = React.useMemo(
    () =>
      token
        ? { Authorization: `Bearer ${token}` }
        : ({} as Record<string, string>),
    [token]
  );

  return {
    token: token as string | null,
    setToken: setToken as (token: string) => void,
    clearToken: clearToken as () => void,
    headers: headers as Record<string, string>,
    isAuthenticated: token !== null,
  };
}
