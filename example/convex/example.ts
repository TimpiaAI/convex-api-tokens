/**
 * Example usage of the API Token Management component.
 */
import { ApiTokens, createTokenAuth, encryptValue, decryptValue } from "../../src/client/index.js";
import { components } from "./_generated/server.js";
import { mutation, action, query, httpAction } from "./_generated/server.js";
import { v } from "convex/values";

// Initialize the component
const apiTokens = new ApiTokens(components.apiTokens);

// ─── Token Operations ───────────────────────────────────────────

/**
 * Create a new API token for a user.
 */
export const createToken = mutation({
  args: {
    name: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // In a real app, authenticate the user:
    // const userId = await getAuthUserId(ctx);
    const userId = "user_123";

    const expiresAt = args.expiresInDays
      ? Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000
      : undefined;

    return await apiTokens.create(ctx, {
      namespace: userId,
      name: args.name ?? "My API Key",
      metadata: { scopes: ["read", "write"] },
      expiresAt,
      maxIdleMs: 30 * 24 * 60 * 60 * 1000, // 30 day idle timeout
    });
  },
});

/**
 * Validate an API token.
 */
export const validateToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const result = await apiTokens.validate(ctx, { token: args.token });
    if (!result.ok) {
      throw new Error(`Token invalid: ${result.reason}`);
    }
    return result;
  },
});

/**
 * List tokens for the current user.
 */
export const listTokens = query({
  args: { includeRevoked: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = "user_123";
    return await apiTokens.list(ctx, {
      namespace: userId,
      includeRevoked: args.includeRevoked,
    });
  },
});

/**
 * Revoke a token by ID.
 */
export const revokeToken = mutation({
  args: { tokenId: v.string() },
  handler: async (ctx, args) => {
    return await apiTokens.invalidateById(ctx, { tokenId: args.tokenId });
  },
});

/**
 * Rotate a token.
 */
export const rotateToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await apiTokens.refresh(ctx, { token: args.token });
  },
});

/**
 * Revoke all tokens for the current user.
 */
export const revokeAllTokens = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = "user_123";
    return await apiTokens.invalidateAll(ctx, { namespace: userId });
  },
});

// ─── Encrypted Key Storage ──────────────────────────────────────

/**
 * Store a third-party API key (encrypted).
 */
export const storeThirdPartyKey = action({
  args: {
    keyName: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = "user_123";
    const secret = process.env.API_TOKENS_ENCRYPTION_KEY;
    if (!secret) throw new Error("API_TOKENS_ENCRYPTION_KEY not set");

    const { encryptedValue, iv } = await encryptValue(args.value, secret);

    await ctx.runMutation(apiTokens.component.public.storeEncryptedKey, {
      namespace: userId,
      keyName: args.keyName,
      encryptedValue,
      iv,
    });
  },
});

/**
 * Retrieve a decrypted third-party API key.
 */
export const getThirdPartyKey = action({
  args: { keyName: v.string() },
  handler: async (ctx, args) => {
    const userId = "user_123";
    const secret = process.env.API_TOKENS_ENCRYPTION_KEY;
    if (!secret) throw new Error("API_TOKENS_ENCRYPTION_KEY not set");

    const record = await ctx.runQuery(
      apiTokens.component.public.getEncryptedKey,
      { namespace: userId, keyName: args.keyName }
    );

    if (!record) return null;
    return await decryptValue(record.encryptedValue, record.iv, secret);
  },
});
