import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node", // override per-file to "jsdom" for component tests
    globals: true,
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**", "src/app/api/**", "src/app/page.tsx"],
      exclude: ["src/app/layout.tsx", "**/*.d.ts"],
      thresholds: { lines: 80, functions: 85, branches: 75, statements: 80 },
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } }, // mirror tsconfig paths
});
