import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // API tokens issued by the component
  tokens: defineTable({
    // The hashed token value (never store raw tokens)
    tokenHash: v.string(),
    // A prefix of the token for display (e.g. "sk_...abc")
    tokenPrefix: v.string(),
    // Namespace for logical grouping — any Convex value (user ID, org ID, app name, etc.)
    namespace: v.any(),
    // Optional human-readable name/label
    name: v.optional(v.string()),
    // Arbitrary metadata (scopes, permissions, etc.)
    metadata: v.optional(v.any()),
    // Absolute expiration timestamp (ms since epoch), null = never expires
    expiresAt: v.optional(v.number()),
    // Idle timeout in ms — token invalidated after this period of no use
    maxIdleMs: v.optional(v.number()),
    // Last time the token was used (for idle timeout)
    lastUsedAt: v.number(),
    // Creation timestamp
    createdAt: v.number(),
    // Whether the token has been revoked
    revoked: v.boolean(),
    // If this token was refreshed, link to the new token
    replacedBy: v.optional(v.string()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_namespace", ["namespace"])
    .index("by_namespace_revoked", ["namespace", "revoked"])
    .index("by_expiresAt", ["expiresAt"]),

  // Encrypted third-party API keys
  encryptedKeys: defineTable({
    namespace: v.any(),
    keyName: v.string(),
    // Encrypted value (base64 encoded)
    encryptedValue: v.string(),
    // Initialization vector for decryption (base64 encoded)
    iv: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_namespace_keyName", ["namespace", "keyName"]),

  // Component configuration (onInvalidate callback, etc.)
  config: defineTable({
    key: v.string(),
    value: v.any(),
  })
    .index("by_key", ["key"]),
});
