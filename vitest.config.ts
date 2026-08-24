import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Copilot SDK 1.0.8 blocks the upstream test suite's insecure localhost
    // BYOK mock transport. Protocol translators remain covered by unit tests.
    exclude: ["test/integration/**"],
    environment: "node",
  },
  resolve: {
    conditions: ["copilot-sdk-proxy-dev"],
    alias: [
      {
        find: /^#(.+)\.js$/,
        replacement: resolve(root, "src/$1.ts"),
      },
    ],
  },
});
