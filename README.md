# convex-api-tokens

[![npm](https://img.shields.io/npm/v/convex-api-tokens)](https://www.npmjs.com/package/convex-api-tokens)
[![license](https://img.shields.io/npm/l/convex-api-tokens)](https://github.com/TimpiaAI/convex-api-tokens/blob/main/LICENSE)

A [Convex](https://convex.dev) component for **API token management** — issuance, validation, rotation, revocation, and encrypted third-party key storage.

Built for SaaS apps that need to issue API keys to users, validate them on incoming requests, and securely store third-party credentials.

> **Convex Components Challenge** — Issue [#12](https://github.com/get-convex/components-submissions-directory/issues/12): API Token Management

## Features

- **Token Issuance** — Generate `sk_`-prefixed tokens with namespaces, expiration, idle timeouts, and metadata
- **Token Validation** — Validate tokens with detailed failure reasons (`expired`, `idle_timeout`, `revoked`, `invalid`)
- **Token Rotation** — Refresh tokens while preserving metadata and audit trail
- **Bulk Revocation** — Revoke by namespace, time range, or individual token
- **Encrypted Key Storage** — AES-256-GCM encrypted storage for third-party API keys (Stripe, OpenAI, etc.)
- **Token Listing** — Admin/dashboard queries for token management (never exposes raw tokens)
- **HTTP Middleware** — `createTokenAuth()` helper for protecting HTTP endpoints
- **Automatic Cleanup** — Built-in cleanup for expired/revoked tokens

## Installation

```bash
npm install convex-api-tokens
```

## Setup

### 1. Register the component

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import apiTokens from "convex-api-tokens/convex.config";

const app = defineApp();
app.use(apiTokens);

export default app;
```

### 2. Initialize the client

```ts
// convex/tokens.ts
import { ApiTokens } from "convex-api-tokens";
import { components } from "./_generated/api.js";

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
import { mutation } from "./_generated/server.js";
import { v } from "convex/values";

export const createToken = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    const result = await apiTokens.create(ctx, {
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
    const result = await apiTokens.validate(ctx, { token: args.token });

    if (!result.ok) {
      throw new Error(`Token invalid: ${result.reason}`);
      // reason: "expired" | "idle_timeout" | "revoked" | "invalid"
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
    const result = await apiTokens.refresh(ctx, { token: args.token });

    if (!result.ok) throw new Error(result.reason);
    return result; // { token, tokenPrefix, tokenId }
  },
});
```

### Revoke tokens

```ts
// Single token by raw value
await apiTokens.invalidate(ctx, { token: rawToken });

// Single token by ID (admin dashboard)
await apiTokens.invalidateById(ctx, { tokenId: "token_id_here" });

// All tokens for a user
await apiTokens.invalidateAll(ctx, { namespace: userId });

// All tokens created before a date
await apiTokens.invalidateAll(ctx, {
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
    return await apiTokens.list(ctx, {
      namespace: userId,
      includeRevoked: false,
    });
  },
});
```

### Store third-party API keys

```ts
import { encryptValue, decryptValue } from "convex-api-tokens";

// In an action — encrypt and store
export const storeApiKey = action({
  args: { keyName: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.API_TOKENS_ENCRYPTION_KEY!;
    const { encryptedValue, iv } = await encryptValue(args.value, secret);

    await apiTokens.storeEncrypted(ctx, {
      namespace: "my_app",
      keyName: args.keyName,
      encryptedValue,
      iv,
    });
  },
});

// In an action — retrieve and decrypt
export const getApiKey = action({
  args: { keyName: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.API_TOKENS_ENCRYPTION_KEY!;
    const record = await apiTokens.getEncryptedKey(ctx, {
      namespace: "my_app",
      keyName: args.keyName,
    });

    if (!record) return null;
    return await decryptValue(record.encryptedValue, record.iv, secret);
  },
});
```

### Protect HTTP endpoints

```ts
import { createTokenAuth } from "convex-api-tokens";

const withApiToken = createTokenAuth(components.apiTokens);

export const myEndpoint = httpAction(async (ctx, request) => {
  const auth = await withApiToken(ctx, request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  // auth.namespace and auth.metadata available here
  return new Response(JSON.stringify({ user: auth.namespace }));
});
```

## API Reference

### `ApiTokens` class

| Method | Context | Description |
|--------|---------|-------------|
| `create(ctx, args)` | mutation | Issue a new token |
| `validate(ctx, args)` | mutation | Validate and touch a token |
| `touch(ctx, args)` | mutation | Reset idle timeout |
| `refresh(ctx, args)` | mutation | Rotate token, preserve metadata |
| `invalidate(ctx, args)` | mutation | Revoke single token by value |
| `invalidateById(ctx, args)` | mutation | Revoke by token ID |
| `invalidateAll(ctx, args)` | mutation | Bulk revoke with filters |
| `list(ctx, args)` | query | List tokens for namespace |
| `storeEncrypted(ctx, args)` | mutation | Store encrypted third-party key |
| `getEncryptedKey(ctx, args)` | query | Get encrypted key record |
| `deleteEncrypted(ctx, args)` | mutation | Delete encrypted key |
| `listEncryptedKeys(ctx, args)` | query | List key names for namespace |

### `createTokenAuth(component)`

Returns `(ctx, request) => Promise<ValidateTokenResult>` for HTTP endpoint auth.

### `encryptValue(plaintext, secret)` / `decryptValue(encrypted, iv, secret)`

AES-256-GCM encryption utilities for use in Convex actions.

## Security

- Tokens are **SHA-256 hashed** before storage — raw tokens are never persisted
- Third-party keys use **AES-256-GCM** encryption with PBKDF2 key derivation (100,000 iterations)
- Token prefixes (`sk_ab12...ef56`) are stored for display without exposing the full token
- Component tables are **isolated** — your app code cannot accidentally access them
- Random IVs ensure identical plaintexts produce different ciphertexts

## Demo

See the [example app](https://github.com/TimpiaAI/convex-api-tokens/tree/main/example) for a complete working integration.

## Author

Built and maintained by [TimpiaAI](https://github.com/TimpiaAI).

## License

[MIT](https://github.com/TimpiaAI/convex-api-tokens/blob/main/LICENSE)
