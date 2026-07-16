import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    exclude: process.env.TEST_DATABASE_URL ? [] : [
      "tests/operations.integration.test.ts",
      "tests/operatoros-operations.integration.test.ts",
    ],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@server": path.resolve(__dirname, "server"),
    },
  },
});
