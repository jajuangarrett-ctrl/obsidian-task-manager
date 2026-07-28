import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tools/**/*.test.ts"],
    environment: "node",
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});
