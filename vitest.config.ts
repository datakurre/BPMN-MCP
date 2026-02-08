import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    // bpmn-js is heavy; run sequentially to avoid OOM in CI
    sequence: { concurrent: false },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/headless-canvas.ts", "src/bpmn-auto-layout.d.ts"],
      reporter: ["text", "text-summary"],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
