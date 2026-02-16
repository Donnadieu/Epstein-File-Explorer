import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts", "shared/**/*.ts"],
      exclude: [
        "server/index.ts",
        "server/vite.ts",
        "server/static.ts",
        "server/seed.ts",
        "server/migrate.ts",
        "server/background-worker.ts",
        "server/db.ts",
        "server/r2.ts",
        "server/chat/**",
        "server/replit_integrations/**",
        "**/*.test.ts",
      ],
    },
  },
});
