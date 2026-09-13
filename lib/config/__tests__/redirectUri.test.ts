import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OAuth redirect derivation.
 *
 * This is worth pinning because the failure mode is invisible from inside the
 * app: point a redirect at the wrong origin and the button still works, the
 * request still leaves, and the user lands on the *provider's* error page.
 * Nothing here logs anything. The only defence is getting the value right
 * before it ships, so the value is derived rather than configured.
 */

const ENV_KEYS = [
  "APP_URL",
  "GOOGLE_REDIRECT_URI",
  "DRIVE_REDIRECT_URI",
  "NOTION_REDIRECT_URI",
  "GITHUB_REDIRECT_URI",
  "SLACK_REDIRECT_URI",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Imported fresh each time: `config` reads process.env through lazy getters. */
async function loadConfig() {
  const mod = await import("../env");
  return mod;
}

describe("connectorRedirectUri", () => {
  it("derives production callbacks from the production origin", async () => {
    process.env.APP_URL = "https://cobrain.co";
    const { config } = await loadConfig();

    expect(config.connectorRedirectUri("gmail")).toBe("https://cobrain.co/api/gmail/callback");
    expect(config.connectorRedirectUri("drive")).toBe("https://cobrain.co/api/drive/callback");
    expect(config.connectorRedirectUri("notion")).toBe("https://cobrain.co/api/notion/callback");
    expect(config.connectorRedirectUri("github")).toBe("https://cobrain.co/api/github/callback");
    expect(config.connectorRedirectUri("slack")).toBe("https://cobrain.co/api/slack/callback");
  });

  it("derives localhost callbacks in development, from the same code path", async () => {
    process.env.APP_URL = "http://localhost:3000";
    const { config } = await loadConfig();

    expect(config.connectorRedirectUri("slack")).toBe(
      "http://localhost:3000/api/slack/callback"
    );
  });

  it("gives Drive its own callback rather than Gmail's", async () => {
    // Drive used to fall back to GOOGLE_REDIRECT_URI, which is Gmail's
    // callback — so an unset DRIVE_REDIRECT_URI sent Drive's grant to the
    // Gmail handler and stored it as a GmailConnection.
    process.env.APP_URL = "https://cobrain.co";
    process.env.GOOGLE_REDIRECT_URI = "https://cobrain.co/api/gmail/callback";
    const { config } = await loadConfig();

    expect(config.connectorRedirectUri("drive")).toBe("https://cobrain.co/api/drive/callback");
    expect(config.connectorRedirectUri("drive")).not.toContain("gmail");
  });

  it("does not double the slash when APP_URL has a trailing one", async () => {
    process.env.APP_URL = "https://cobrain.co/";
    const { config } = await loadConfig();
    expect(config.connectorRedirectUri("notion")).toBe("https://cobrain.co/api/notion/callback");
  });

  it("still honours an explicit override", async () => {
    // Kept for providers whose registered URI cannot match the derived shape.
    process.env.APP_URL = "https://cobrain.co";
    process.env.SLACK_REDIRECT_URI = "https://cobrain.co/oauth/slack";
    const { config } = await loadConfig();
    expect(config.connectorRedirectUri("slack")).toBe("https://cobrain.co/oauth/slack");
  });
});

describe("assertProductionConfig — redirect guard", () => {
  /**
   * Loads the module with APP_ENV=production. `isProduction` is a module-level
   * const, so it has to be set before import and the registry reset after.
   */
  async function loadProd(env: Record<string, string>) {
    vi.resetModules();
    process.env.APP_ENV = "production";
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    return import("../env");
  }

  // Everything assertProductionConfig reads. Production `need()` throws on any
  // missing value, so an incomplete fixture fails on the wrong thing.
  const BASE = {
    APP_URL: "https://cobrain.co",
    DATABASE_URL: "postgresql://x",
    AUTH_DATABASE_URL: "postgresql://x",
    BETTER_AUTH_SECRET: "s",
    REDIS_URL: "redis://r:6379",
    MINIO_ENDPOINT: "localhost",
    MINIO_ACCESS_KEY: "key",
    MINIO_SECRET_KEY: "real-secret",
    ANTHROPIC_API_KEY: "k",
  };

  afterEach(() => {
    delete process.env.APP_ENV;
    vi.resetModules();
  });

  it("rejects a dev redirect copied into production", async () => {
    // The exact accident this exists to catch.
    const { assertProductionConfig } = await loadProd({
      ...BASE,
      SLACK_REDIRECT_URI: "http://localhost:3000/api/slack/callback",
    });

    expect(() => assertProductionConfig()).toThrowError(/slack OAuth redirect is not a production URL/);
  });

  it("rejects plain http even on the right host", async () => {
    // An OAuth code delivered over http is a code delivered in cleartext.
    const { assertProductionConfig } = await loadProd({
      ...BASE,
      NOTION_REDIRECT_URI: "http://cobrain.co/api/notion/callback",
    });

    expect(() => assertProductionConfig()).toThrowError(/notion OAuth redirect is not a production URL/);
  });

  it("passes when every redirect derives from the production origin", async () => {
    const { assertProductionConfig } = await loadProd(BASE);
    expect(() => assertProductionConfig()).not.toThrow();
  });
});
