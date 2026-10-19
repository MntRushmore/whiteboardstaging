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
    // The iPad brain: a minified bundle generated from src/lib/brain by scripts/build-ios-brain.mjs
    // (`npm run brain:check` keeps it current); its sources are linted.
    "ios/Packages/AgathonBrain/Sources/AgathonBrain/Resources/brain.js",
  ]),
]);

export default eslintConfig;
