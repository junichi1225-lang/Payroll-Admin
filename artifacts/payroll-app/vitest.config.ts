// Vitest 専用設定。vite.config.ts は開発サーバー用に PORT 環境変数を必須とするため、
// テスト実行時はこちらが優先されるように分離している（Node 環境の純関数テストのみ）。
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
