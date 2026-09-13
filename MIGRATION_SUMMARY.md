# Clerk → Better Auth Migration Summary

## Migration Completed ✅

This document tracks the complete migration from Clerk to Better Auth for the companyBrain application.

---

## Changes Made

### 1. **Prisma Schema Updates**
- ✅ Added Better Auth models:
  - `User` (replaces Clerk's implicit user table)
  - `Session` (session management with tokens)
  - `Account` (OAuth provider accounts)
  - `Verification` (email verification)
- ✅ Updated all business logic models with User relations:
  - `Workflow.userId` → `Workflow.user`
  - `GitHubConnection.userId` → `GitHubConnection.user`
  - `GmailConnection.userId` → `GmailConnection.user`
  - `NotionConnection.userId` → `NotionConnection.user`
  - `CustomConnection.userId` → `CustomConnection.user`
  - `WorkflowExecution.userId` → `WorkflowExecution.user`
  - `ExecutionPhase.userId` → `ExecutionPhase.user`

### 2. **Dependencies**
- ✅ Removed: `@clerk/nextjs`
- ✅ Added: `better-auth`, `@better-auth/prisma`, `bcryptjs`

### 3. **Auth Infrastructure**
- ✅ Created `lib/auth.ts` - Better Auth main configuration
- ✅ Created `lib/auth-client.ts` - Client-side auth client
- ✅ Created `lib/get-session.ts` - Server-side session helpers
- ✅ Created `app/api/auth/[...betterauth]/route.ts` - Auth API handler

### 4. **Root Layout**
- ✅ Removed `ClerkProvider` wrapper
- ✅ Kept `ThemeProvider` and `AppProviders` intact

### 5. **Authentication Pages**
- ✅ Rewrote `app/(auth)/sign-in/[[...sign-in]]/page.tsx`
  - White background (per requirements)
  - Google OAuth button
  - GitHub OAuth button
  - Email/password form
  - Loading states
- ✅ Rewrote `app/(auth)/sign-up/[[...sign-up]]/page.tsx`
  - Full name, email, password, confirm password fields
  - Google/GitHub OAuth
  - Password validation (min 8 chars, match confirmation)

### 6. **Server Actions** (5 files updated)
- ✅ `actions/workflows/getWorkflows.ts` - Uses `getCurrentUserId()`
- ✅ `actions/workflows/createWorkflow.ts` - Uses `getCurrentUserId()`
- ✅ `actions/workflows/deleteWorkflow.ts` - Uses `getCurrentUserId()`
- ✅ `actions/workflows/updateWorkflow.ts` - Uses `getCurrentUserId()`
- ✅ `actions/workflows/runWorkflow.ts` - Uses `getCurrentUserId()`

### 7. **API Routes** (10 files updated)
- ✅ `app/api/workflow/[workflowId]/route.ts`
- ✅ `app/api/workflow/[workflowId]/run/route.ts`
- ✅ `app/api/gmail/callback/route.ts` - OAuth callback
- ✅ `app/api/gmail/sync/route.ts` - Data sync endpoint
- ✅ `app/api/github/callback/route.ts` - OAuth callback
- ✅ `app/api/notion/callback/route.ts` - OAuth callback
- ✅ `app/api/custom_api/auth/route.ts` - Custom connector auth
- ✅ `app/api/custom_api/status/route.ts` - Custom connector status
- ✅ `app/api/search/route.ts` - Vector search
- ✅ `app/api/document/[docId]/status/route.ts` - Document status

### 8. **Dashboard Layout**
- ✅ Removed Clerk's `UserButton`
- ✅ Created custom `components/UserMenu.tsx` with:
  - User avatar with initials
  - User info display
  - Sign out functionality
  - Settings menu (placeholder)

### 9. **Middleware**
- ✅ Created `middleware.ts` for protected route enforcement
  - Protects `/dashboard`, `/connectors`, `/activity` routes
  - Protects API routes except `/api/auth`
  - Redirects unauthenticated users to `/sign-in`

### 10. **Environment Configuration**
- ✅ Updated `.env`:
  - Removed `NEXT_PUBLIC_CLERK_*` and `CLERK_SECRET_KEY`
  - Added `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`
  - Added `GOOGLE_OAUTH_*` and `GITHUB_OAUTH_*` for Better Auth OAuth config
- ✅ Updated `backend/docker-compose.yml` to use new env vars

---

## Database Migration Steps

**CRITICAL:** Before running the app, you must:

```bash
# Install dependencies
pnpm install

# Run Prisma migrations to create new tables
npx prisma migrate dev --name add_better_auth_models

# (Optional) Generate Prisma client
npx prisma generate
```

This creates:
- `User` table (replaces Clerk's user table)
- `Session` table (for session management)
- `Account` table (for OAuth connections)
- `Verification` table (for email verification)
- Adds foreign key constraints to existing tables

---

## Known Configuration

### Database Connection
- **Local Development**: `postgresql://company_brain:company_brain@localhost:5432/company_brain`
- **Docker Compose**: `postgresql://company_brain:company_brain@postgres:5432/company_brain` (app connects to `postgres` service)

### Better Auth Configuration
```typescript
{
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignInAfterSignUp: false
  },
  socialProviders: {
    google: { clientId, clientSecret },
    github: { clientId, clientSecret }
  },
  session: {
    expiresIn: 7 days,
    updateAge: 1 day,
    cookieCache: 5 minutes
  }
}
```

---

## Testing Checklist

- [ ] **Database Migration**
  - [ ] Run `npx prisma migrate dev`
  - [ ] Verify tables created in DB
  - [ ] Check User, Session, Account, Verification tables exist

- [ ] **Sign-Up Flow**
  - [ ] Navigate to `/sign-up`
  - [ ] Create account with email/password
  - [ ] Verify email validation check
  - [ ] Confirm password validation (min 8 chars, match)
  - [ ] Check user created in DB

- [ ] **Sign-In Flow**
  - [ ] Navigate to `/sign-in`
  - [ ] Sign in with email/password
  - [ ] Verify session created
  - [ ] Check httpOnly cookie set

- [ ] **OAuth Flow**
  - [ ] Test Google OAuth sign-in
  - [ ] Test GitHub OAuth sign-in
  - [ ] Verify Account records created in DB

- [ ] **Protected Routes**
  - [ ] Try accessing `/` without auth → redirects to `/sign-in`
  - [ ] Try accessing `/connectors` without auth → redirects to `/sign-in`
  - [ ] Signed in → can access protected routes

- [ ] **Workflow Operations**
  - [ ] Create workflow
  - [ ] Edit workflow definition
  - [ ] Save workflow
  - [ ] Delete workflow
  - [ ] Verify userId associations in DB

- [ ] **Connector Auth**
  - [ ] Connect GitHub account
  - [ ] Connect Gmail account
  - [ ] Connect Notion account
  - [ ] Verify connections stored with correct userId

- [ ] **Sign Out**
  - [ ] Click sign out in UserMenu
  - [ ] Verify session removed
  - [ ] Redirected to `/sign-in`
  - [ ] Cannot access protected routes

- [ ] **TypeScript Compilation**
  - [ ] Run `pnpm build`
  - [ ] Zero TypeScript errors

---

## Security Notes

### Password Hashing
- Better Auth uses bcryptjs by default (cost factor 12)
- Passwords are hashed on server, never transmitted plaintext
- Never logged or exposed

### Session Management
- Access tokens: 7-day expiry
- Session updates: Daily
- httpOnly cookies: Secure, SameSite=strict
- Token rotation: Not yet implemented (add for security)

### OAuth Token Storage
- **IMPORTANT**: OAuth tokens (Gmail, GitHub, Notion) are still stored **plaintext** in the DB
- **TODO** (Phase 2): Encrypt OAuth tokens using AES-256-GCM (see `docs/architecture/security.txt` Section 5)

---

## Phase 2: Security Hardening

From `docs/architecture/security.txt` Section 5:

```typescript
// TODO: Encrypt OAuth tokens
model GmailConnection {
  // Currently plaintext (UNSAFE):
  accessToken: String
  
  // Should be (SAFE):
  accessTokenEnc: String
  accessTokenIv: String
  accessTokenTag: String
  
  // Use AES-256-GCM with master key in env
}
```

Implement before production deployment.

---

## Files Modified

**Schema:**
- `prisma/schema.prisma` (+70 lines)

**Auth Core:**
- `lib/auth.ts` (new)
- `lib/auth-client.ts` (new)
- `lib/get-session.ts` (new)
- `app/api/auth/[...betterauth]/route.ts` (new)

**UI:**
- `app/layout.tsx` (removed ClerkProvider)
- `app/(auth)/sign-in/[[...sign-in]]/page.tsx` (complete rewrite)
- `app/(auth)/sign-up/[[...sign-up]]/page.tsx` (complete rewrite)
- `app/(dashboard)/layout.tsx` (replaced UserButton)
- `components/UserMenu.tsx` (new)
- `middleware.ts` (new)

**Actions & API:**
- 5 server action files (updated auth calls)
- 10 API route files (updated auth calls)

**Configuration:**
- `package.json` (dependency update)
- `.env` (env vars update)
- `backend/docker-compose.yml` (env vars update)

---

## Rollback Plan

If issues arise:
1. `git checkout` the original files (Clerk still in package.json)
2. Keep Clerk providers running in parallel during Phase 1
3. Test Better Auth on staging first
4. Gradual user migration (dual-auth window)

---

## Next Steps

1. ✅ **Merge & Test** (you are here)
2. 📦 **Run `pnpm install`** - install new dependencies
3. 🗄️ **Run `npx prisma migrate dev`** - create new tables
4. 🚀 **Start dev server** - `pnpm dev`
5. ✔️ **Run test checklist** above
6. 🔐 **Implement encryption** (Phase 2) - encrypt OAuth tokens
7. 📊 **Monitor** - check logs for errors, track session creation

---

## Questions?

Refer to:
- `docs/architecture/security.txt` - Security architecture & auth design
- `docs/architecture/frontend_quick_reference.txt` - Frontend patterns
- Better Auth docs: https://www.better-auth.com/docs
- Prisma docs: https://www.prisma.io/docs
