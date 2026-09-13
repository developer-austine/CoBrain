import "server-only";

/**
 * Runtime configuration — the one place environment differences live.
 *
 * Everything the server needs is read (and validated) here, so a missing
 * production secret fails loudly at boot instead of silently degrading at 3am.
 * Dev keeps working defaults; production requires the values to be explicit.
 */

export type AppEnv = "development" | "production" | "test";

export const APP_ENV: AppEnv =
  (process.env.APP_ENV as AppEnv) ||
  (process.env.NODE_ENV as AppEnv) ||
  "development";

export const isProduction = APP_ENV === "production";

/** Read a var, falling back to `dev` outside production. Throws in prod. */
function need(name: string, dev?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (!isProduction && dev !== undefined) return dev;
  throw new Error(
    `[config] Missing required environment variable "${name}" in ${APP_ENV}.`
  );
}

/** Optional var with a default in every environment. */
function opt(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/**
 * Connectors that complete an OAuth round trip back to this app.
 *
 * The callback path is always `/api/<provider>/callback`, which is what lets
 * the redirect be derived rather than configured five times.
 */
export const CONNECTOR_PROVIDERS = ["gmail", "drive", "notion", "github", "slack"] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

/**
 * Per-provider override, for the case where a provider's registered URI cannot
 * match the derived one. Setting these is not the normal path.
 */
const REDIRECT_OVERRIDE: Record<ConnectorProvider, string> = {
  gmail: "GOOGLE_REDIRECT_URI",
  drive: "DRIVE_REDIRECT_URI",
  notion: "NOTION_REDIRECT_URI",
  github: "GITHUB_REDIRECT_URI",
  slack: "SLACK_REDIRECT_URI",
};

/**
 * Runtime config. Every field is a **lazy getter** so that merely importing
 * this module never throws — required-var validation happens when a value is
 * actually read at runtime (and eagerly at boot via `assertProductionConfig`).
 *
 * This matters for `next build`: Next imports route modules to collect their
 * metadata, and the build runs with `NODE_ENV=production`. If the fields were
 * evaluated eagerly, a runtime-only secret that isn't present in the build
 * environment (e.g. `APP_URL`) would throw and fail the build.
 */
export const config = {
  env: APP_ENV,
  isProduction,

  /** Public origin of the app (OAuth callbacks, absolute links). */
  get appUrl() {
    return need("APP_URL", "http://localhost:3000");
  },

  /**
   * Where a provider sends the user back after consent.
   *
   * Derived from `appUrl`, so production is `https://cobrain.co/api/<p>/callback`
   * and development is `http://localhost:3000/api/<p>/callback` with nothing to
   * keep in sync. Previously each provider read its own env var, which meant
   * five values that could each be copied from dev into production — and the
   * symptom of getting one wrong is a provider-side error page that this app
   * never sees and never logs.
   *
   * An explicit override still wins, for providers whose registered URI cannot
   * match the derived shape. In production `assertProductionConfig` rejects an
   * override that still points at localhost, so a copied dev value fails at
   * boot rather than at a user's first click.
   */
  connectorRedirectUri(provider: ConnectorProvider): string {
    const override = process.env[REDIRECT_OVERRIDE[provider]];
    if (override) return override;
    return `${config.appUrl.replace(/\/+$/, "")}/api/${provider}/callback`;
  },

  /** Business Postgres (workflows, connectors, brain blocks). */
  get databaseUrl() {
    return need("DATABASE_URL");
  },

  /** Redis — the ingestion queue. */
  get redisUrl() {
    return need("REDIS_URL", "redis://localhost:6379");
  },

  /** Python search-api (vector retrieval). */
  get pythonBackendUrl() {
    return need("PYTHON_BACKEND_URL", "http://localhost:8000");
  },

  /** Qdrant — read directly only by the Python side; here for health checks. */
  get qdrantUrl() {
    return opt("QDRANT_URL", "http://localhost:6333");
  },

  /** Object storage for uploaded documents. */
  get storage() {
    return {
      endpoint: need("MINIO_ENDPOINT", "localhost"),
      port: Number(opt("MINIO_PORT", "9000")),
      useSSL: opt("MINIO_USE_SSL", "false") === "true",
      accessKey: need("MINIO_ACCESS_KEY", "cobrain"),
      secretKey: need("MINIO_SECRET_KEY", "cobrain-dev-secret"),
      bucket: opt("MINIO_BUCKET", "cobrain-uploads"),
    };
  },

  /** AI + speech. Optional: the app degrades gracefully without them. */
  get anthropicApiKey() {
    return process.env.ANTHROPIC_API_KEY || null;
  },
  get assemblyAiApiKey() {
    return process.env.ASSEMBLYAI_API_KEY || null;
  },
} as const;

/**
 * Fail fast on boot in production if anything critical is missing or unsafe.
 * Call from instrumentation.ts.
 */
export function assertProductionConfig(): void {
  if (!isProduction) return;

  const problems: string[] = [];

  if (config.appUrl.includes("localhost")) {
    problems.push("APP_URL still points at localhost");
  }
  if (!process.env.AUTH_DATABASE_URL && !process.env.NEON_DATABASE_URL) {
    problems.push("AUTH_DATABASE_URL (auth store) is unset");
  }
  if (!process.env.BETTER_AUTH_SECRET) {
    problems.push("BETTER_AUTH_SECRET is unset");
  }
  if (!config.storage.useSSL && !config.storage.endpoint.includes("localhost")) {
    problems.push("MINIO_USE_SSL=false against a remote storage endpoint");
  }
  if (config.storage.secretKey === "cobrain-dev-secret") {
    problems.push("MINIO_SECRET_KEY is still the development default");
  }
  // A localhost callback in production is the failure that hides: the app
  // starts, the button works, and the provider shows its own error page.
  for (const provider of CONNECTOR_PROVIDERS) {
    const uri = config.connectorRedirectUri(provider);
    if (uri.includes("localhost") || uri.startsWith("http://")) {
      problems.push(
        `${provider} OAuth redirect is not a production URL (${uri}) — ` +
          `unset ${REDIRECT_OVERRIDE[provider]} to derive it from APP_URL`
      );
    }
  }

  if (!config.anthropicApiKey) {
    problems.push("ANTHROPIC_API_KEY is unset — chat will fall back to extractive answers");
  }

  if (problems.length > 0) {
    const msg = problems.map((p) => `  - ${p}`).join("\n");
    // Secrets/TLS problems are fatal; the AI key is only a warning.
    const fatal = problems.filter((p) => !p.includes("ANTHROPIC_API_KEY"));
    if (fatal.length > 0) {
      throw new Error(`[config] Unsafe production configuration:\n${msg}`);
    }
    console.warn(`[config] Production warnings:\n${msg}`);
  }
}
