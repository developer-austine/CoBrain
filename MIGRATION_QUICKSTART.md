# Quick Start: Clerk → Better Auth Migration

## Complete Setup in 5 Steps

### Step 1: Install Dependencies
```bash
cd c:\Users\Max\My-Projects\companyBrain\ Tech\c_brain
pnpm install
```

Expected: Installs better-auth, @better-auth/prisma, bcryptjs, and all other deps.

---

### Step 2: Generate Prisma Client
```bash
npx prisma generate
```

Expected: Generates client in `lib/generated/prisma/`.

---

### Step 3: Create Database Schema
```bash
npx prisma migrate dev --name add_better_auth_models
```

**What this does:**
- Creates `User` table (replaces Clerk's implicit user table)
- Creates `Session` table (for session management)
- Creates `Account` table (for OAuth provider accounts)
- Creates `Verification` table (for email verification)
- Adds User foreign key relations to all business models

**Expected output:**
```
✔ Your database has been successfully migrated
✔ Generated Prisma Client in lib/generated/prisma
```

---

### Step 4: Verify .env Configuration

Verify `.env` has:
```env
# Better Auth
BETTER_AUTH_SECRET="your-secret-key-change-in-production"
BETTER_AUTH_URL="http://localhost:3000"

# OAuth (for sign-in/sign-up via social)
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...

# OAuth (for connector integrations - Gmail, GitHub data sync)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

---

### Step 5: Start the Dev Server
```bash
pnpm dev
```

Expected:
```
- Ready on http://localhost:3000
- API running on /api/auth/[...betterauth]
```

---

## Test the Migration (5 minutes)

### ✅ Test 1: Sign Up
1. Open http://localhost:3000
2. → Redirects to `/sign-in` (no auth)
3. Click "Sign up" link
4. Fill form:
   - Name: "Test User"
   - Email: "test@example.com"
   - Password: "Test123!@"
   - Confirm: "Test123!@"
5. Click "Sign Up"
6. → Success message "Account created!"
7. Check database:
   ```sql
   SELECT * FROM "User" WHERE email = 'test@example.com';
   ```
   Should see new user record.

### ✅ Test 2: Sign In
1. Go to http://localhost:3000/sign-in
2. Enter:
   - Email: "test@example.com"
   - Password: "Test123!@"
3. Click "Sign In"
4. → Redirected to `/` (protected route accessible)
5. Check database:
   ```sql
   SELECT * FROM "Session" WHERE "userId" = '<user-id>';
   ```
   Should see session record.

### ✅ Test 3: Create Workflow
1. On home page, click "Create Workflow"
2. Enter name: "Test Flow"
3. Click create
4. → Workflow created and visible
5. Check database:
   ```sql
   SELECT * FROM "Workflow" WHERE "userId" = '<user-id>';
   ```
   Should see workflow with matching userId.

### ✅ Test 4: Sign Out
1. Click avatar in top-right
2. Click "Sign out"
3. → Redirected to `/sign-in`
4. Try accessing `/` → Redirects to `/sign-in` again
5. Check database:
   ```sql
   SELECT * FROM "Session" WHERE "userId" = '<user-id>';
   ```
   Session should be cleared/revoked.

### ✅ Test 5: OAuth (Optional)
1. Go to `/sign-in`
2. Click "Continue with GitHub"
3. → GitHub OAuth flow
4. Authorize app
5. → Signed in to app
6. Check database:
   ```sql
   SELECT * FROM "Account" WHERE "providerId" = 'github';
   ```
   Should see GitHub account record.

---

## Verify TypeScript Compilation

```bash
pnpm build
```

Expected: **0 TypeScript errors, builds successfully to .next/**.

---

## If Errors Occur

### Error: "prismaAdapter not found"
**Solution:** Run `pnpm install` again, ensure `@better-auth/prisma` is installed.

### Error: "BETTER_AUTH_SECRET not set"
**Solution:** Add `BETTER_AUTH_SECRET="test-secret"` to `.env`.

### Error: "Database migration failed"
**Solution:** 
1. Verify `DATABASE_URL` points to running PostgreSQL
2. Check `npx prisma db push` works
3. Reset DB: `npx prisma migrate reset` (clears all data)

### Error: "Session not found after sign-in"
**Solution:**
1. Check browser cookies (DevTools → Application → Cookies)
2. Verify `auth-session` cookie exists with httpOnly flag
3. Check `.next/server/middleware.js` is loaded

### Blank sign-in/sign-up page
**Solution:**
1. Check browser console for JS errors
2. Verify `lib/auth-client.ts` exports are correct
3. Clear `.next/` cache: `rm -r .next && pnpm dev`

---

## Database Reset (Start Fresh)

If you want to clear all data and start fresh:

```bash
# Destructive - deletes all data
npx prisma migrate reset

# Or manually:
DROP TABLE IF EXISTS "Session";
DROP TABLE IF EXISTS "User";
DROP TABLE IF EXISTS "Account";
DROP TABLE IF EXISTS "Verification";

# Then re-run migration
npx prisma migrate dev --name add_better_auth_models
```

---

## Production Deployment

Before deploying to production:

1. **Generate a strong secret:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Set as `BETTER_AUTH_SECRET` in production env.

2. **Verify database URL** points to production PostgreSQL.

3. **Enable encryption** (see MIGRATION_SUMMARY.md Phase 2):
   - Encrypt OAuth tokens with AES-256-GCM
   - Store master key in secret manager

4. **Run migrations:**
   ```bash
   npx prisma migrate deploy
   ```

5. **Test on staging first** before production.

---

## File Structure After Migration

```
c_brain/
├── lib/
│   ├── auth.ts                          # ← NEW: Better Auth config
│   ├── auth-client.ts                   # ← NEW: Client-side auth
│   ├── get-session.ts                   # ← NEW: Server session helpers
│   ├── prisma.ts                        # (unchanged)
│   └── ...
├── app/
│   ├── api/
│   │   └── auth/[...betterauth]/route.ts # ← NEW: Auth API handler
│   ├── (auth)/
│   │   ├── sign-in/[[...sign-in]]/page.tsx      # ← UPDATED: Custom form
│   │   └── sign-up/[[...sign-up]]/page.tsx      # ← UPDATED: Custom form
│   ├── (dashboard)/
│   │   └── layout.tsx                   # ← UPDATED: Removed UserButton
│   ├── layout.tsx                       # ← UPDATED: Removed ClerkProvider
│   └── ...
├── components/
│   └── UserMenu.tsx                     # ← NEW: Custom user menu
├── prisma/
│   └── schema.prisma                    # ← UPDATED: +Better Auth models
├── middleware.ts                        # ← NEW: Route protection
├── MIGRATION_SUMMARY.md                 # ← NEW: Full migration doc
└── ...
```

---

## Support

If you get stuck:

1. Check **MIGRATION_SUMMARY.md** for detailed changes
2. Review **docs/architecture/security.txt** for auth design
3. Check Better Auth docs: https://www.better-auth.com
4. Check Prisma docs: https://www.prisma.io

---

**Status:** ✅ Migration complete. Ready to test and deploy.
