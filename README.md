# @ovipi/convex-api-tokens

A Convex component for **API token management** — issuance, validation, rotation, revocation, and encrypted third-party key storage.

Built for SaaS apps that need to issue API keys to users, validate them on incoming requests, and securely store third-party credentials.

## Features

- **Token Issuance** — Generate `sk_`-prefixed tokens with namespaces, expiration, idle timeouts, and metadata
- **Token Validation** — Validate tokens with detailed failure reasons (expired, idle, revoked, invalid)
- **Token Rotation** — Refresh tokens while preserving metadata and audit trail
- **Bulk Revocation** — Revoke by namespace, time range, or individual token
- **Encrypted Key Storage** — AES-256-GCM encrypted storage for third-party API keys (Stripe, OpenAI, etc.)
- **Token Listing** — Admin/dashboard queries for token management (never exposes raw tokens)
- **HTTP Middleware** — `createTokenAuth()` helper for protecting HTTP endpoints
- **Automatic Cleanup** — Built-in cleanup for expired/revoked tokens

## Installation

```bash
npm install @ovipi/convex-api-tokens
```

## Setup

### 1. Register the component

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import apiTokens from "@ovipi/convex-api-tokens/convex.config";

const app = defineApp();
app.use(apiTokens);

export default app;
```

### 2. Initialize the client

```ts
// convex/tokens.ts
import { ApiTokens } from "@ovipi/convex-api-tokens";
import { components } from "./_generated/server.js";
import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

const apiTokens = new ApiTokens(components.apiTokens);
```

### 3. (Optional) Set encryption key for third-party key storage

In your Convex dashboard, set the environment variable:

```
API_TOKENS_ENCRYPTION_KEY=your-secret-key-here
```

## Usage

### Create a token

```ts
export const createToken = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    const result = await ctx.runMutation(apiTokens.create, {
      namespace: userId,
      name: args.name ?? "My API Key",
      metadata: { scopes: ["read", "write"] },
      expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000, // 90 days
      maxIdleMs: 30 * 24 * 60 * 60 * 1000, // 30 day idle timeout
    });

    // result.token is the raw key — show it once to the user
    // result.tokenPrefix is "sk_ab12...ef56" for display
    return result;
  },
});
```

### Validate a token

```ts
export const validateToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(apiTokens.validate, {
      token: args.token,
    });

    if (!result.ok) {
      throw new Error(`Token invalid: ${result.reason}`);
    }

    return { namespace: result.namespace, metadata: result.metadata };
  },
});
```

### Rotate a token

```ts
export const rotateToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(apiTokens.refresh, {
      token: args.token,
    });

    if (!result.ok) throw new Error(result.reason);
    return result; // { token, tokenPrefix, tokenId }
  },
});
```

### Revoke tokens

```ts
// Single token
await ctx.runMutation(apiTokens.invalidate, { token: rawToken });

// All tokens for a user
await ctx.runMutation(apiTokens.invalidateAll, { namespace: userId });

// All tokens created before a date
await ctx.runMutation(apiTokens.invalidateAll, {
  namespace: userId,
  before: Date.now() - 90 * 24 * 60 * 60 * 1000,
});
```

### List tokens (admin dashboard)

```ts
export const listTokens = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return await ctx.runQuery(apiTokens.list, {
      namespace: userId,
      includeRevoked: false,
    });
  },
});
```

### Store third-party API keys

```ts
// Store encrypted
await ctx.runAction(apiTokens.storeEncrypted, {
  namespace: userId,
  keyName: "stripe_secret",
  value: "sk_live_...",
});

// Retrieve decrypted
const key = await ctx.runAction(apiTokens.getDecrypted, {
  namespace: userId,
  keyName: "stripe_secret",
});
```

### Protect HTTP endpoints

```ts
import { createTokenAuth } from "@ovipi/convex-api-tokens";
import { components } from "./_generated/server.js";

const withApiToken = createTokenAuth(components.apiTokens);

export const myEndpoint = httpAction(async (ctx, request) => {
  const auth = await withApiToken(ctx, request);
  if (!auth.ok) {
    return new Response("Unauthorized", { status: 401 });
  }
  // auth.namespace and auth.metadata available
});
```

## API Reference

### `ApiTokens` class

| Method | Type | Description |
|--------|------|-------------|
| `create` | mutation | Issue a new token |
| `validate` | mutation | Validate and touch a token |
| `touch` | mutation | Reset idle timeout |
| `refresh` | mutation | Rotate token, preserve metadata |
| `invalidate` | mutation | Revoke single token |
| `invalidateById` | mutation | Revoke by token ID |
| `invalidateAll` | mutation | Bulk revoke with filters |
| `list` | query | List tokens for namespace |
| `storeEncrypted` | action | Store encrypted third-party key |
| `getDecrypted` | action | Retrieve decrypted key |
| `deleteEncrypted` | mutation | Delete encrypted key |
| `listEncryptedKeys` | query | List key names for namespace |

### `createTokenAuth(component)`

Returns a function `(ctx, request) => Promise<ValidationResult>` for HTTP endpoint auth.

## Security

- Tokens are **SHA-256 hashed** before storage — raw tokens are never persisted
- Third-party keys use **AES-256-GCM** encryption with PBKDF2 key derivation
- Token prefixes (`sk_ab12...ef56`) are stored for display without exposing the full token
- Component tables are **isolated** — your app code cannot accidentally read them

## License

MIT
