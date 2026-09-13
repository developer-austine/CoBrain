import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // "server-only" is a build-time guard with no runtime implementation;
      // stub it so server modules can be imported directly in tests.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
