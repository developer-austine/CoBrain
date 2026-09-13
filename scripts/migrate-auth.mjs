import { readFileSync } from "fs";
import { getMigrations } from "better-auth/db/migration";
import pg from "pg";

const { Pool } = pg;

// Load .env manually
const envContent = readFileSync(".env", "utf-8");
envContent.split("\n").forEach((line) => {
  const match = line.match(/^([A-Z_]+)=["']?([^"'\n]+)["']?/);
  if (match) process.env[match[1]] = match[2];
});

const config = {
  database: new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
};

console.log("Computing Better Auth migrations for Neon...");

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(config);

console.log(
  "Tables to create:",
  toBeCreated.map((t) => t.table).join(", ") || "(none)"
);
console.log(
  "Tables to alter:",
  toBeAdded.map((t) => t.table).join(", ") || "(none)"
);

if (toBeCreated.length === 0 && toBeAdded.length === 0) {
  console.log("✓ Schema already up to date. Nothing to migrate.");
  process.exit(0);
}

console.log("Running migrations...");
await runMigrations();
console.log("✓ Migrations applied successfully.");
process.exit(0);
