import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

// ─── Token Helpers ───────────────────────────────────────────────

/**
 * Generate a cryptographically random token string.
 * Format: "sk_" + 48 random hex chars
 */
function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sk_${hex}`;
}

/**
 * Hash a token using SHA-256 for storage.
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get a display prefix from a token (e.g. "sk_ab12...ef56")
 */
function getTokenPrefix(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 7)}...${token.slice(-4)}`;
}

// ─── Encryption Helpers ──────────────────────────────────────────

async function deriveKey(secret: string, usage: "encrypt" | "decrypt") {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("convex-api-tokens-salt"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
}

async function encryptInternal(
  plaintext: string,
  secret: string
): Promise<{ encryptedValue: string; iv: string }> {
  const encoder = new TextEncoder();
  const key = await deriveKey(secret, "encrypt");
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

async function decryptInternal(
  encryptedValue: string,
  iv: string,
  secret: string
): Promise<string> {
  const key = await deriveKey(secret, "decrypt");
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(encryptedValue), (c) => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    data
  );
  return new TextDecoder().decode(decrypted);
}

function getEncryptionKey(): string {
  const key = process.env.API_TOKENS_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "API_TOKENS_ENCRYPTION_KEY environment variable is not set. " +
      "Set it in your Convex dashboard for encrypted key storage."
    );
  }
  return key;
}

// ─── Token CRUD ──────────────────────────────────────────────────

/**
 * Create a new API token.
 * Returns the raw token (only time it's available).
 */
export const create = mutation({
  args: {
    namespace: v.any(),
    name: v.optional(v.string()),
    metadata: v.optional(v.any()),
    expiresAt: v.optional(v.number()),
    maxIdleMs: v.optional(v.number()),
  },
  returns: v.object({
    token: v.string(),
    tokenPrefix: v.string(),
    tokenId: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const tokenPrefix = getTokenPrefix(token);

    const tokenId = await ctx.db.insert("tokens", {
      tokenHash,
      tokenPrefix,
      namespace: args.namespace,
      name: args.name,
      metadata: args.metadata,
      expiresAt: args.expiresAt,
      maxIdleMs: args.maxIdleMs,
      lastUsedAt: now,
      createdAt: now,
      revoked: false,
    });

    return {
      token,
      tokenPrefix,
      tokenId: tokenId as string,
    };
  },
});

/**
 * Validate a token and return its status + metadata.
 */
export const validate = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(
      v.union(
        v.literal("expired"),
        v.literal("idle_timeout"),
        v.literal("revoked"),
        v.literal("invalid")
      )
    ),
    namespace: v.optional(v.any()),
    metadata: v.optional(v.any()),
    tokenId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const record = await ctx.db
      .query("tokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!record) {
      return { ok: false, reason: "invalid" as const };
    }

    if (record.revoked) {
      return {
        ok: false,
        reason: "revoked" as const,
        namespace: record.namespace,
      };
    }

    const now = Date.now();

    if (record.expiresAt && now > record.expiresAt) {
      return {
        ok: false,
        reason: "expired" as const,
        namespace: record.namespace,
      };
    }

    if (record.maxIdleMs && now - record.lastUsedAt > record.maxIdleMs) {
      return {
        ok: false,
        reason: "idle_timeout" as const,
        namespace: record.namespace,
      };
    }

    // Touch: update lastUsedAt
    await ctx.db.patch(record._id, { lastUsedAt: now });

    return {
      ok: true,
      namespace: record.namespace,
      metadata: record.metadata,
      tokenId: record._id as string,
    };
  },
});

/**
 * Touch a token to reset its idle timeout without full validation.
 */
export const touch = mutation({
  args: {
    token: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const record = await ctx.db
      .query("tokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!record || record.revoked) return false;

    await ctx.db.patch(record._id, { lastUsedAt: Date.now() });
    return true;
  },
});

/**
 * Refresh a token: invalidate the old one and issue a new one,
 * preserving metadata and linking history.
 */
export const refresh = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    token: v.optional(v.string()),
    tokenPrefix: v.optional(v.string()),
    tokenId: v.optional(v.string()),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const record = await ctx.db
      .query("tokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!record) {
      return { ok: false, reason: "invalid" };
    }

    if (record.revoked) {
      return { ok: false, reason: "revoked" };
    }

    const now = Date.now();
    const newToken = generateToken();
    const newTokenHash = await hashToken(newToken);
    const newTokenPrefix = getTokenPrefix(newToken);

    // Create new token with same metadata
    const newTokenId = await ctx.db.insert("tokens", {
      tokenHash: newTokenHash,
      tokenPrefix: newTokenPrefix,
      namespace: record.namespace,
      name: record.name,
      metadata: record.metadata,
      expiresAt: record.expiresAt,
      maxIdleMs: record.maxIdleMs,
      lastUsedAt: now,
      createdAt: now,
      revoked: false,
    });

    // Revoke old token and link to new one
    await ctx.db.patch(record._id, {
      revoked: true,
      replacedBy: newTokenId as string,
    });

    return {
      ok: true,
      token: newToken,
      tokenPrefix: newTokenPrefix,
      tokenId: newTokenId as string,
    };
  },
});

/**
 * Revoke a single token.
 */
export const invalidate = mutation({
  args: {
    token: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const record = await ctx.db
      .query("tokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!record) return false;

    await ctx.db.patch(record._id, { revoked: true });
    return true;
  },
});

/**
 * Revoke a token by its ID (for admin/dashboard use).
 */
export const invalidateById = mutation({
  args: {
    tokenId: v.id("tokens"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.tokenId);
    if (!record) return false;

    await ctx.db.patch(args.tokenId, { revoked: true });
    return true;
  },
});

/**
 * Bulk revoke tokens by namespace and/or time range.
 */
export const invalidateAll = mutation({
  args: {
    namespace: v.optional(v.any()),
    before: v.optional(v.number()),
    after: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let tokensQuery;

    if (args.namespace !== undefined) {
      tokensQuery = ctx.db
        .query("tokens")
        .withIndex("by_namespace_revoked", (q) =>
          q.eq("namespace", args.namespace).eq("revoked", false)
        );
    } else {
      tokensQuery = ctx.db.query("tokens");
    }

    const tokens = await tokensQuery.collect();
    let count = 0;

    for (const token of tokens) {
      if (token.revoked) continue;

      if (args.before && token.createdAt >= args.before) continue;
      if (args.after && token.createdAt <= args.after) continue;

      await ctx.db.patch(token._id, { revoked: true });
      count++;
    }

    return count;
  },
});

/**
 * List tokens for a namespace (for admin/dashboard).
 * Never returns the actual token value.
 */
export const list = query({
  args: {
    namespace: v.any(),
    includeRevoked: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      tokenId: v.string(),
      tokenPrefix: v.string(),
      name: v.optional(v.string()),
      namespace: v.any(),
      metadata: v.optional(v.any()),
      expiresAt: v.optional(v.number()),
      maxIdleMs: v.optional(v.number()),
      lastUsedAt: v.number(),
      createdAt: v.number(),
      revoked: v.boolean(),
      replacedBy: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    let tokensQuery;

    if (args.includeRevoked) {
      tokensQuery = ctx.db
        .query("tokens")
        .withIndex("by_namespace", (q) => q.eq("namespace", args.namespace));
    } else {
      tokensQuery = ctx.db
        .query("tokens")
        .withIndex("by_namespace_revoked", (q) =>
          q.eq("namespace", args.namespace).eq("revoked", false)
        );
    }

    const tokens = await tokensQuery.collect();

    return tokens.map((t) => ({
      tokenId: t._id as string,
      tokenPrefix: t.tokenPrefix,
      name: t.name,
      namespace: t.namespace,
      metadata: t.metadata,
      expiresAt: t.expiresAt,
      maxIdleMs: t.maxIdleMs,
      lastUsedAt: t.lastUsedAt,
      createdAt: t.createdAt,
      revoked: t.revoked,
      replacedBy: t.replacedBy,
    }));
  },
});

/**
 * Clean up expired and revoked tokens older than a threshold.
 * Can be called from the client or scheduled via cron.
 */
export const cleanup = mutation({
  args: {
    olderThanMs: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const threshold = args.olderThanMs ?? 30 * 24 * 60 * 60 * 1000; // 30 days default
    const cutoff = Date.now() - threshold;
    let deleted = 0;

    // Delete revoked tokens older than threshold
    const revokedTokens = await ctx.db.query("tokens").collect();
    for (const token of revokedTokens) {
      const shouldDelete =
        (token.revoked && token.createdAt < cutoff) ||
        (token.expiresAt && token.expiresAt < cutoff);

      if (shouldDelete) {
        await ctx.db.delete(token._id);
        deleted++;
      }
    }

    return deleted;
  },
});

// ─── Encrypted Key Storage (server-side encryption) ──────────────

/**
 * Store a third-party API key with server-side encryption.
 * Encrypts the plaintext value using AES-256-GCM with the env key.
 */
export const storeValue = mutation({
  args: {
    namespace: v.any(),
    keyName: v.string(),
    value: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const secret = getEncryptionKey();
    const { encryptedValue, iv } = await encryptInternal(args.value, secret);
    const now = Date.now();

    const existing = await ctx.db
      .query("encryptedKeys")
      .withIndex("by_namespace_keyName", (q) =>
        q.eq("namespace", args.namespace).eq("keyName", args.keyName)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedValue,
        iv,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("encryptedKeys", {
        namespace: args.namespace,
        keyName: args.keyName,
        encryptedValue,
        iv,
        createdAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

/**
 * Retrieve and decrypt a stored third-party API key.
 * Decrypts server-side using the env key — works in queries.
 */
export const getValue = query({
  args: {
    namespace: v.any(),
    keyName: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("encryptedKeys")
      .withIndex("by_namespace_keyName", (q) =>
        q.eq("namespace", args.namespace).eq("keyName", args.keyName)
      )
      .first();

    if (!record) return null;

    const secret = getEncryptionKey();
    return await decryptInternal(record.encryptedValue, record.iv, secret);
  },
});

/**
 * Store an encrypted third-party API key (pre-encrypted).
 * For cases where encryption is done client-side.
 */
export const storeEncryptedKey = mutation({
  args: {
    namespace: v.any(),
    keyName: v.string(),
    encryptedValue: v.string(),
    iv: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("encryptedKeys")
      .withIndex("by_namespace_keyName", (q) =>
        q.eq("namespace", args.namespace).eq("keyName", args.keyName)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedValue: args.encryptedValue,
        iv: args.iv,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("encryptedKeys", {
        namespace: args.namespace,
        keyName: args.keyName,
        encryptedValue: args.encryptedValue,
        iv: args.iv,
        createdAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

/**
 * Get an encrypted key record (still encrypted).
 */
export const getEncryptedKey = query({
  args: {
    namespace: v.any(),
    keyName: v.string(),
  },
  returns: v.union(
    v.object({
      encryptedValue: v.string(),
      iv: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("encryptedKeys")
      .withIndex("by_namespace_keyName", (q) =>
        q.eq("namespace", args.namespace).eq("keyName", args.keyName)
      )
      .first();

    if (!record) return null;

    return {
      encryptedValue: record.encryptedValue,
      iv: record.iv,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  },
});

/**
 * Delete an encrypted key.
 */
export const deleteEncryptedKey = mutation({
  args: {
    namespace: v.any(),
    keyName: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("encryptedKeys")
      .withIndex("by_namespace_keyName", (q) =>
        q.eq("namespace", args.namespace).eq("keyName", args.keyName)
      )
      .first();

    if (!record) return false;

    await ctx.db.delete(record._id);
    return true;
  },
});

/**
 * List all encrypted key names for a namespace.
 */
export const listEncryptedKeys = query({
  args: {
    namespace: v.any(),
  },
  returns: v.array(
    v.object({
      keyName: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("encryptedKeys")
      .withIndex("by_namespace_keyName", (q) =>
        q.eq("namespace", args.namespace)
      )
      .collect();

    return records.map((r) => ({
      keyName: r.keyName,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },
});
