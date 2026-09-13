import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Prisma client is generated into the source tree (see the `output` in
    // schema.prisma), so it is not covered by the ignores above. Linting it
    // produced 655 of the repo's ~700 errors — `any`, `{}`, `require()`,
    // `this` aliasing — none of them actionable, all of them regenerated on
    // the next `prisma generate`. That volume buried the few dozen real
    // findings in hand-written code, which is the only reason to run a linter.
    "lib/generated/**",
  ]),
]);

export default eslintConfig;
