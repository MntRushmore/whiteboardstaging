import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
    // Fake-timer loop tests can flake under parallel-worker CPU contention; one retry keeps CI honest but stable.
    retry: 1,
  },
});
