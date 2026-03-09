import type { GenericDataModel } from "convex/server";
import type { api } from "../component/_generated/api.js";

type ComponentApi = typeof api;

// Context types for running component functions from the app
interface RunMutationCtx {
  runMutation: <Args extends Record<string, any>, Returns>(
    ref: any,
    args: Args
  ) => Promise<Returns>;
}

interface RunQueryCtx {
  runQuery: <Args extends Record<string, any>, Returns>(
    ref: any,
    args: Args
  ) => Promise<Returns>;
}

interface RunActionCtx {
  runAction: <Args extends Record<string, any>, Returns>(
    ref: any,
    args: Args
  ) => Promise<Returns>;
}

// ─── Result Types ────────────────────────────────────────────────

export interface CreateTokenResult {
  token: string;
  tokenPrefix: string;
  tokenId: string;
}

export interface ValidateTokenResult {
  ok: boolean;
  reason?: "expired" | "idle_timeout" | "revoked" | "invalid";
  namespace?: string;
  metadata?: any;
  tokenId?: string;
}

export interface RefreshTokenResult {
  ok: boolean;
  token?: string;
  tokenPrefix?: string;
  tokenId?: string;
  reason?: string;
}

export interface TokenInfo {
  tokenId: string;
  tokenPrefix: string;
  name?: string;
  namespace: string;
  metadata?: any;
  expiresAt?: number;
  maxIdleMs?: number;
  lastUsedAt: number;
  createdAt: number;
  revoked: boolean;
  replacedBy?: string;
}

export interface EncryptedKeyInfo {
  keyName: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Main Client Class ──────────────────────────────────────────

export interface ApiTokensOptions {
  /**
   * Environment variable name containing the encryption key
   * for third-party key storage. Defaults to "API_TOKENS_ENCRYPTION_KEY".
   */
  encryptionKeyEnvVar?: string;
}

/**
 * Client for the API Token Management component.
 *
 * Usage:
 * ```ts
 * import { ApiTokens } from "convex-api-tokens";
 * import { components } from "./_generated/server.js";
 *
 * const apiTokens = new ApiTokens(components.apiTokens);
 *
 * // In your mutation:
 * const result = await apiTokens.create(ctx, {
 *   namespace: userId,
 *   name: "My API Key",
 * });
 * ```
 */
export class ApiTokens {
  public component: ComponentApi;
  private encryptionKeyEnvVar: string;

  constructor(component: ComponentApi, options?: ApiTokensOptions) {
    this.component = component;
    this.encryptionKeyEnvVar =
      options?.encryptionKeyEnvVar ?? "API_TOKENS_ENCRYPTION_KEY";
  }

  // ─── Token Operations ────────────────────────────────────────

  /**
   * Create a new API token.
   * Returns the raw token — this is the only time it's visible.
   */
  async create(
    ctx: RunMutationCtx,
    args: {
      namespace: string;
      name?: string;
      metadata?: any;
      expiresAt?: number;
      maxIdleMs?: number;
    }
  ): Promise<CreateTokenResult> {
    return await ctx.runMutation(this.component.public.create, args);
  }

  /**
   * Validate a token and return its status + metadata.
   * Also updates lastUsedAt (touch) on success.
   */
  async validate(
    ctx: RunMutationCtx,
    args: { token: string }
  ): Promise<ValidateTokenResult> {
    return await ctx.runMutation(this.component.public.validate, args);
  }

  /**
   * Touch a token to reset its idle timeout without full validation.
   */
  async touch(
    ctx: RunMutationCtx,
    args: { token: string }
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.public.touch, args);
  }

  /**
   * Refresh a token: revoke the old one, issue a new one with same metadata.
   */
  async refresh(
    ctx: RunMutationCtx,
    args: { token: string }
  ): Promise<RefreshTokenResult> {
    return await ctx.runMutation(this.component.public.refresh, args);
  }

  /**
   * Revoke a single token by its raw value.
   */
  async invalidate(
    ctx: RunMutationCtx,
    args: { token: string }
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.public.invalidate, args);
  }

  /**
   * Revoke a token by its document ID (for admin dashboards).
   */
  async invalidateById(
    ctx: RunMutationCtx,
    args: { tokenId: string }
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.public.invalidateById, {
      tokenId: args.tokenId,
    });
  }

  /**
   * Bulk revoke tokens with optional filters.
   */
  async invalidateAll(
    ctx: RunMutationCtx,
    args: {
      namespace?: string;
      before?: number;
      after?: number;
    }
  ): Promise<number> {
    return await ctx.runMutation(this.component.public.invalidateAll, args);
  }

  /**
   * List tokens for a namespace (admin/dashboard).
   * Never returns the raw token value — only prefixes.
   */
  async list(
    ctx: RunQueryCtx,
    args: {
      namespace: string;
      includeRevoked?: boolean;
    }
  ): Promise<TokenInfo[]> {
    return await ctx.runQuery(this.component.public.list, args);
  }

  // ─── Encrypted Key Storage ───────────────────────────────────

  /**
   * Store an encrypted third-party API key.
   * The value is encrypted with AES-256-GCM before storage.
   */
  async storeEncrypted(
    ctx: RunMutationCtx,
    args: {
      namespace: string;
      keyName: string;
      encryptedValue: string;
      iv: string;
    }
  ): Promise<void> {
    await ctx.runMutation(this.component.public.storeEncryptedKey, args);
  }

  /**
   * Get an encrypted key record (still encrypted — decrypt in your action).
   */
  async getEncryptedKey(
    ctx: RunQueryCtx,
    args: {
      namespace: string;
      keyName: string;
    }
  ): Promise<{ encryptedValue: string; iv: string; createdAt: number; updatedAt: number } | null> {
    return await ctx.runQuery(this.component.public.getEncryptedKey, args);
  }

  /**
   * Delete an encrypted key.
   */
  async deleteEncrypted(
    ctx: RunMutationCtx,
    args: {
      namespace: string;
      keyName: string;
    }
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.public.deleteEncryptedKey, args);
  }

  /**
   * List encrypted key names for a namespace (does not return values).
   */
  async listEncryptedKeys(
    ctx: RunQueryCtx,
    args: {
      namespace: string;
    }
  ): Promise<EncryptedKeyInfo[]> {
    return await ctx.runQuery(this.component.public.listEncryptedKeys, args);
  }
}

// ─── Middleware Helper ────────────────────────────────────────────

/**
 * Create token-authenticated middleware for HTTP endpoints.
 *
 * Usage:
 * ```ts
 * import { createTokenAuth } from "convex-api-tokens";
 * import { components } from "./_generated/server.js";
 *
 * const withApiToken = createTokenAuth(components.apiTokens);
 *
 * export default httpRouter((router) => {
 *   router.route({
 *     path: "/api/data",
 *     method: "GET",
 *     handler: httpAction(async (ctx, request) => {
 *       const auth = await withApiToken(ctx, request);
 *       if (!auth.ok) {
 *         return new Response(JSON.stringify({ error: auth.reason }), {
 *           status: 401,
 *           headers: { "Content-Type": "application/json" },
 *         });
 *       }
 *       // auth.namespace and auth.metadata are available
 *     }),
 *   });
 * });
 * ```
 */
export function createTokenAuth(component: ComponentApi) {
  return async (
    ctx: RunMutationCtx,
    request: Request
  ): Promise<ValidateTokenResult & { ok: boolean }> => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return {
        ok: false,
        reason: "invalid" as const,
      };
    }

    const token = authHeader.slice(7);
    return await ctx.runMutation(component.public.validate, { token });
  };
}

// ─── Encryption Utilities (for use in actions) ───────────────────

/**
 * Encrypt a value using AES-256-GCM. Use this in your actions before
 * calling apiTokens.storeEncrypted().
 */
export async function encryptValue(
  plaintext: string,
  secret: string
): Promise<{ encryptedValue: string; iv: string }> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("convex-api-tokens-salt"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );
  return {
    encryptedValue: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/**
 * Decrypt a value using AES-256-GCM. Use this in your actions after
 * calling apiTokens.getEncryptedKey().
 */
export async function decryptValue(
  encryptedValue: string,
  iv: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("convex-api-tokens-salt"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(encryptedValue), (c) => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    data
  );
  return new TextDecoder().decode(decrypted);
}

export default ApiTokens;
