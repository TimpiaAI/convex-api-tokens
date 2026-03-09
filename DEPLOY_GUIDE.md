# Convex API Token Management Component — Deployment Guide

## What This Is

A Convex component for the **Components Authoring Challenge** (Issue #12 — $300 reward).

Handles API token issuance, validation, rotation, revocation, and encrypted third-party key storage for SaaS apps.

---

## Step 1: Create GitHub Repository

```bash
cd ~/convex-api-tokens

# Init repo and first commit
git init
git add -A
git commit -m "feat: API token management Convex component

- Token issuance with sk_ prefix, SHA-256 hashing, namespaces
- Token validation with expiry, idle timeout, revocation detection
- Token rotation preserving metadata and audit trail
- Bulk revocation by namespace and time range
- AES-256-GCM encrypted third-party key storage
- HTTP middleware helper (createTokenAuth)
- Admin listing (never exposes raw tokens)
- Full TypeScript types and example app"

# Create GitHub repo (public, so Convex team can review)
gh repo create convex-api-tokens --public --source=. --push
```

---

## Step 2: Publish to npm

You need an npm account. If you don't have one:
```bash
npm adduser
```

Then publish:
```bash
cd ~/convex-api-tokens

# Build first
npm run build

# Publish (use your own scope or remove @ovipi/ from package.json)
npm publish --access public
```

If you want to use a different package name, edit `package.json`:
```bash
# Option A: scoped (recommended)
# Change "name": "@ovipi/convex-api-tokens" to "@YOUR_NPM_USERNAME/convex-api-tokens"

# Option B: unscoped
# Change "name": "@ovipi/convex-api-tokens" to "convex-api-tokens"
```

---

## Step 3: Create Demo App

Since your Convex account is linked to Vercel, create the project from the Vercel dashboard:

1. Go to https://vercel.com/new
2. Choose "Convex" as the framework/integration
3. Name it `api-tokens-demo`

Or create a standalone demo:

```bash
cd ~
npx create-convex@latest api-tokens-demo --template react
cd api-tokens-demo

# Install your component
npm install @ovipi/convex-api-tokens
```

Then wire it up in the demo app:

**`convex/convex.config.ts`**:
```typescript
import { defineApp } from "convex/server";
import apiTokens from "@ovipi/convex-api-tokens/convex.config";

const app = defineApp();
app.use(apiTokens);

export default app;
```

**`convex/tokens.ts`**:
```typescript
import { ApiTokens } from "@ovipi/convex-api-tokens";
import { components } from "./_generated/server.js";
import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

const apiTokens = new ApiTokens(components.apiTokens);

export const createToken = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await apiTokens.create(ctx, {
      namespace: "demo_user",
      name: args.name,
      metadata: { scopes: ["read", "write"] },
    });
  },
});

export const validateToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await apiTokens.validate(ctx, { token: args.token });
  },
});

export const listTokens = query({
  args: {},
  handler: async (ctx) => {
    return await apiTokens.list(ctx, {
      namespace: "demo_user",
      includeRevoked: true,
    });
  },
});

export const revokeToken = mutation({
  args: { tokenId: v.string() },
  handler: async (ctx, args) => {
    return await apiTokens.invalidateById(ctx, { tokenId: args.tokenId });
  },
});

export const rotateToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await apiTokens.refresh(ctx, { token: args.token });
  },
});
```

Deploy and test:
```bash
npx convex dev
```

---

## Step 4: Submit to Challenge

Go to: https://github.com/get-convex/components-submissions-directory

Submit with:
- **Component name**: convex-api-tokens
- **npm package**: @ovipi/convex-api-tokens
- **GitHub repo**: https://github.com/YOUR_USERNAME/convex-api-tokens
- **Demo app URL**: (your deployed demo URL)
- **Category**: API Usage / Auth & Identity
- **Challenge issue**: #12 — API token management component

---

## Project Structure

```
convex-api-tokens/
├── src/
│   ├── client/
│   │   └── index.ts          # ApiTokens class, createTokenAuth, encrypt/decrypt utils
│   ├── component/
│   │   ├── convex.config.ts   # defineComponent("apiTokens")
│   │   ├── schema.ts          # tokens + encryptedKeys tables
│   │   └── public.ts          # All mutations/queries/actions
│   └── test.ts                # Test helpers for convex-test
├── example/
│   └── convex/
│       ├── convex.config.ts   # Example app config
│       ├── example.ts         # Usage examples
│       └── schema.ts          # Example app schema
├── dist/                      # Built output (auto-generated)
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.component.json
├── convex.json
├── README.md
├── LICENSE
└── .gitignore
```

---

## Features Implemented (matching Issue #12 requirements)

| Requirement | Status | Implementation |
|------------|--------|---------------|
| `create({ namespace, expiration?, maxIdle?, metadata? })` | Done | `public.ts:create` |
| `validate(token)` → `{ ok, reason?, namespace?, metadata? }` | Done | `public.ts:validate` |
| Failure reasons: expired, idle_timeout, revoked, invalid | Done | Enum in validate |
| `touch(token)` — reset idle timeout | Done | `public.ts:touch` |
| `refresh(token)` — rotate, preserve metadata | Done | `public.ts:refresh` |
| `invalidate(token)` — revoke single | Done | `public.ts:invalidate` |
| `invalidateAll({ namespace?, before?, after? })` — bulk | Done | `public.ts:invalidateAll` |
| `storeEncrypted` / `getDecrypted` / `deleteEncrypted` | Done | AES-256-GCM |
| Token cleanup (expired/revoked) | Done | `public.ts:cleanup` |
| Token listing (admin, no raw values) | Done | `public.ts:list` |
| HTTP middleware helper | Done | `createTokenAuth()` |

---

## Test Results (22/22 passing)

```
🔑 Token Generation — sk_ prefix, 51 chars, unique
🔒 Token Hashing — SHA-256, deterministic, no leaks
🔐 Encryption — AES-256-GCM, random IV, wrong key fails
📊 Validation — expiry, idle, revoked detection
```

---

## Quick Command Summary

```bash
# Build
cd ~/convex-api-tokens && npm run build

# Create repo + push
git add -A && git commit -m "feat: API token management component" && gh repo create convex-api-tokens --public --source=. --push

# Publish to npm
npm publish --access public

# Create demo app
cd ~ && npx create-convex@latest api-tokens-demo --template react && cd api-tokens-demo && npm install @ovipi/convex-api-tokens
```
