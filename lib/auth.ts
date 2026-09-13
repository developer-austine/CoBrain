import { betterAuth } from "better-auth";
import { Pool } from "pg";

let authInstance: ReturnType<typeof betterAuth> | null = null;
let pool: Pool | null = null;

function initializeAuth() {
  if (authInstance) return authInstance;

  try {
    // Auth database URL. `AUTH_DATABASE_URL` is the portable name used in
    // production (the auth store need not be Neon); `NEON_DATABASE_URL` is the
    // long-standing dev var. Accept either so dev and prod both work.
    const authDbUrl =
      process.env.AUTH_DATABASE_URL || process.env.NEON_DATABASE_URL;
    const secret = process.env.BETTER_AUTH_SECRET;

    if (!authDbUrl || !secret) {
      console.error(
        "Better Auth Error: Missing AUTH_DATABASE_URL/NEON_DATABASE_URL or BETTER_AUTH_SECRET. Check your .env file."
      );
      return null;
    }

    // Reuse a single pg Pool connected to Neon (auth tables live here, separate
    // from the Docker Postgres that holds business-logic data via Prisma).
    //
    // Neon is a serverless Postgres reached over the public internet, so the
    // pool is tuned for that: keepAlive stops NAT/VPN idle timeouts from
    // silently dropping sockets, a bounded connectionTimeout lets a transient
    // DNS/wake failure fail fast (and retry on the next request) instead of
    // hanging, and idle connections are recycled so we don't hold stale ones
    // that Neon has already closed on its side.
    if (!pool) {
      pool = new Pool({
        connectionString: authDbUrl,
        keepAlive: true,
        max: 10,
        // Neon free-tier compute can cold-start (~a few seconds) on the first
        // connection after it auto-suspends — give it room, but not forever.
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 30_000,
      });

      // CRITICAL: without this, an error on an idle client (e.g. Neon closing
      // the connection, or a blip on the VPN resolver) is emitted on the Pool
      // with no listener and can crash the Node process. Log and let the pool
      // recover — the next request opens a fresh connection.
      pool.on("error", (err) => {
        console.error("[auth] idle pg pool error (recovered):", err.message);
      });
    }

    const socialProviders: Record<string, any> = {};

    if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      socialProviders.google = {
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      };
    }

    if (process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET) {
      socialProviders.github = {
        clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
        clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      };
    }

    const config: any = {
      database: pool,
      secret,
      baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
      },
      user: {
        // Allows users to delete their own account from Settings.
        deleteUser: { enabled: true },
      },
      session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
      },
    };

    if (Object.keys(socialProviders).length > 0) {
      config.socialProviders = socialProviders;
    }

    authInstance = betterAuth(config);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Better Auth initialization error:", errMsg);
    console.error(
      "Auth Database URL configured:",
      !!(process.env.AUTH_DATABASE_URL || process.env.NEON_DATABASE_URL)
    );
    console.error("Better Auth Secret configured:", !!process.env.BETTER_AUTH_SECRET);
    return null;
  }

  return authInstance;
}

export const auth = initializeAuth() as ReturnType<typeof betterAuth>;
