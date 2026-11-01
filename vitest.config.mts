import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/domain/**/*.ts", "src/services/**/*.ts", "src/actions/**/*.ts", "src/resolvers/**/*.ts", "src/triggers/**/*.ts"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
