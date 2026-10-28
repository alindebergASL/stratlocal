import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,mjs}"],
    // A fresh database before every test, so a pure-function file that grows
    // a query later does not start accumulating state across its own cases.
    setupFiles: ["tests/setup.ts"],
    env: {
      // Tests never touch the real database file.
      DB_PATH: ":memory:",
      // Exercise inherited cloud workflows with fake providers. Local-mode
      // regression tests explicitly enable the production default.
      STRATEGY_LOCAL_ONLY: "0",
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
});
