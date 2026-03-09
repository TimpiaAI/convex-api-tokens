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

// ─── Result Types ────────────────────────────────────────────────

export interface CreateTokenResult {
  token: string;
  tokenPrefix: string;
  tokenId: string;
}

export interface ValidateTokenResult<M = any> {
  ok: boolean;
  reason?: "expired" | "idle_timeout" | "revoked" | "invalid";
  namespace?: string;
  metadata?: M;
  tokenId?: string;
}

export interface RefreshTokenResult {
  ok: boolean;
  token?: string;
  tokenPrefix?: string;
  tokenId?: string;
  reason?: string;
}

export interface TokenInfo<M = any> {
  tokenId: string;
  tokenPrefix: string;
  name?: string;
  namespace: string;
  metadata?: M;
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

// ─── Options ─────────────────────────────────────────────────────

export interface ApiTokensOptions<M = any> {
  /**
   * Environment variable name containing the encryption key
   * for third-party key storage. Defaults to "API_TOKENS_ENCRYPTION_KEY".
   */
  encryptionKeyEnvVar?: string;

  /**
   * Optional callback invoked after a token is revoked.
   * Called for invalidate, invalidateById, and invalidateAll.
   * Runs in the caller's mutation context.
   */
  onInvalidate?: (info: {
    namespace?: string;
    tokenId?: string;
    count?: number;
    method: "invalidate" | "invalidateById" | "invalidateAll";
  }) => void | Promise<void>;
}

// ─── Main Client Class ──────────────────────────────────────────

/**
 * Client for the API Token Management component.
 *
 * Supports TypeScript generics for typed metadata:
 * ```ts
 * type MyMeta = { scopes: string[]; orgId: string };
 * const apiTokens = new ApiTokens<MyMeta>(components.apiTokens);
 *
 * // metadata is now typed as MyMeta
 * const result = await apiTokens.validate(ctx, { token });
 * result.metadata?.scopes; // string[]
 * ```
 */
export class ApiTokens<M = any> {
  public component: ComponentApi;
  private encryptionKeyEnvVar: string;
  private onInvalidate?: ApiTokensOptions<M>["onInvalidate"];

  constructor(component: ComponentApi, options?: ApiTokensOptions<M>) {
    this.component = component;
    this.encryptionKeyEnvVar =
      options?.encryptionKeyEnvVar ?? "API_TOKENS_ENCRYPTION_KEY";
    this.onInvalidate = options?.onInvalidate;
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
      metadata?: M;
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
  ): Promise<ValidateTokenResult<M>> {
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
   * Triggers the onInvalidate callback if configured.
   */
  async invalidate(
    ctx: RunMutationCtx,
    args: { token: string }
  ): Promise<boolean> {
    const result = await ctx.runMutation(
      this.component.public.invalidate,
      args
    ) as boolean;
    if (result && this.onInvalidate) {
      await this.onInvalidate({ method: "invalidate" });
    }
    return result;
  }

  /**
   * Revoke a token by its document ID (for admin dashboards).
   * Triggers the onInvalidate callback if configured.
   */
  async invalidateById(
    ctx: RunMutationCtx,
    args: { tokenId: string }
  ): Promise<boolean> {
    const result = await ctx.runMutation(
      this.component.public.invalidateById,
      { tokenId: args.tokenId }
    ) as boolean;
    if (result && this.onInvalidate) {
      await this.onInvalidate({
        method: "invalidateById",
        tokenId: args.tokenId,
      });
    }
    return result;
  }

  /**
   * Bulk revoke tokens with optional filters.
   * Triggers the onInvalidate callback if configured.
   */
  async invalidateAll(
    ctx: RunMutationCtx,
    args: {
      namespace?: string;
      before?: number;
      after?: number;
    }
  ): Promise<number> {
    const count = await ctx.runMutation(
      this.component.public.invalidateAll,
      args
    ) as number;
    if (count > 0 && this.onInvalidate) {
      await this.onInvalidate({
        method: "invalidateAll",
        namespace: args.namespace,
        count,
      });
    }
    return count;
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
  ): Promise<TokenInfo<M>[]> {
    return await ctx.runQuery(this.component.public.list, args);
  }

  /**
   * Clean up expired and revoked tokens older than a threshold.
   * Call this on a schedule (e.g. daily cron) to keep the database clean.
   *
   * @param olderThanMs - Delete tokens older than this (default: 30 days)
   * @returns Number of tokens deleted
   */
  async cleanup(
    ctx: RunMutationCtx,
    args?: { olderThanMs?: number }
  ): Promise<number> {
    return await ctx.runMutation(this.component.public.cleanup, args ?? {});
  }

  // ─── Encrypted Key Storage ───────────────────────────────────

  /**
   * Store an encrypted third-party API key.
   * The value should be encrypted with encryptValue() before storage.
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
   * Get an encrypted key record (still encrypted — decrypt with decryptValue()).
   */
  async getEncryptedKey(
    ctx: RunQueryCtx,
    args: {
      namespace: string;
      keyName: string;
    }
  ): Promise<{
    encryptedValue: string;
    iv: string;
    createdAt: number;
    updatedAt: number;
  } | null> {
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
    return await ctx.runMutation(
      this.component.public.deleteEncryptedKey,
      args
    );
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

// ─── Middleware Helpers ──────────────────────────────────────────

/**
 * Create token-authenticated middleware for HTTP endpoints.
 *
 * Usage:
 * ```ts
 * import { createTokenAuth } from "convex-api-tokens";
 * import { components } from "./_generated/api.js";
 *
 * const withApiToken = createTokenAuth(components.apiTokens);
 *
 * export const myEndpoint = httpAction(async (ctx, request) => {
 *   const auth = await withApiToken(ctx, request);
 *   if (!auth.ok) {
 *     return new Response(JSON.stringify({ error: auth.reason }), {
 *       status: 401,
 *       headers: { "Content-Type": "application/json" },
 *     });
 *   }
 *   // auth.namespace and auth.metadata available
 * });
 * ```
 */
export function createTokenAuth<M = any>(component: ComponentApi) {
  return async (
    ctx: RunMutationCtx,
    request: Request
  ): Promise<ValidateTokenResult<M>> => {
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

/**
 * Helper to protect a mutation handler with token authentication.
 * Extracts the token from args, validates it, and passes auth info to handler.
 *
 * Usage:
 * ```ts
 * import { withTokenAuth } from "convex-api-tokens";
 *
 * const apiTokens = new ApiTokens(components.apiTokens);
 *
 * export const protectedMutation = mutation({
 *   args: { token: v.string(), data: v.string() },
 *   handler: withTokenAuth(apiTokens, async (ctx, args, auth) => {
 *     // auth = { namespace, metadata, tokenId }
 *     // args still has { token, data }
 *     return { saved: true, user: auth.namespace };
 *   }),
 * });
 * ```
 */
export function withTokenAuth<M = any, Args extends { token: string } = any>(
  apiTokens: ApiTokens<M>,
  handler: (
    ctx: any,
    args: Args,
    auth: { namespace: string; metadata?: M; tokenId: string }
  ) => any
) {
  return async (ctx: any, args: Args) => {
    const result = await apiTokens.validate(ctx, { token: args.token });
    if (!result.ok) {
      throw new Error(`Unauthorized: ${result.reason}`);
    }
    return handler(ctx, args, {
      namespace: result.namespace!,
      metadata: result.metadata,
      tokenId: result.tokenId!,
    });
  };
}

// ─── Encryption Utilities (for use in actions) ───────────────────

/**
 * Encrypt a value using AES-256-GCM. Use this in your actions before
 * calling apiTokens.storeEncrypted().
 *
 * Note: Encryption requires crypto.subtle which is available in Convex
 * actions. For mutations/queries, store the encrypted value directly.
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
 *
 * Note: Decryption requires crypto.subtle which is available in Convex
 * actions. For mutations/queries, retrieve the encrypted record and
 * decrypt in a separate action.
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
