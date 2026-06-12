# Phase 0: 開発基盤 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Workers + D1 バックエンドの開発基盤（api-worker パッケージ、D1 対応の lib/db、テスト基盤、CI/CD、Replit との分業ルール）を構築します。

**Architecture:** 新パッケージ `artifacts/api-worker` に Hono で API を実装し、`lib/db` を PostgreSQL から D1（SQLite 方言）へ転換します。テストは `@cloudflare/vitest-pool-workers` で D1 バインディング込みの統合テストを実行し、デプロイは GitHub Actions から `cloudflare/wrangler-action` で行います。

**Tech Stack:** Hono 4 / wrangler 4 / Drizzle ORM（drizzle-orm 0.45 系、drizzle-kit 0.31 系）/ vitest 3.2 系 + @cloudflare/vitest-pool-workers / GitHub Actions

**親計画:** `docs/plans/2026-06-12-cloudflare-workers-d1-backend-plan.md` の Phase 0 を実装します。

---

## 前提

- 作業ブランチは `feature/phase0-dev-foundation`。worktree `.wt/feature/phase0-dev-foundation` で作業します
- Task 1〜5 はローカルで完結します。Task 6 のみ Cloudflare アカウント操作と GitHub Secrets 設定が必要で、ユーザーの実施項目を含みます
- リポジトリは pnpm workspaces のモノレポです。typecheck は必ずルートから `pnpm run typecheck` で実行します。project references の依存グラフを解決するためで、各パッケージ単体で `tsc` を実行すると依存先の `.d.ts` 未生成で失敗します
- 既存の `artifacts/api-server`（Express）には一切手を入れません。削除は Phase 5 で行います

## ファイル構成（このフェーズで作成・変更するもの)

```text
artifacts/api-worker/            # 新規: Workers API
├── package.json
├── tsconfig.json
├── wrangler.jsonc               # Workers 設定（D1 バインディング、preview 環境）
├── worker-configuration.d.ts    # wrangler types による生成物（コミットする）
├── vitest.config.ts
├── src/
│   ├── index.ts                 # Hono アプリ本体
│   └── routes/
│       └── health.ts            # GET /healthz
└── test/
    ├── env.d.ts                 # cloudflare:test の型拡張
    ├── apply-migrations.ts      # テスト前に D1 マイグレーションを適用
    └── healthz.test.ts

lib/db/                          # 変更: PostgreSQL → D1
├── package.json                 # pg を削除、workers-types を追加、scripts を generate に変更
├── drizzle.config.ts            # dialect: sqlite
├── tsconfig.json                # types を workers-types に変更
├── migrations/                  # drizzle-kit generate の出力先（新規）
│   └── .gitkeep
└── src/
    ├── index.ts                 # createDb(d1) ファクトリ
    └── schema/index.ts          # sqliteTable の雛形コメント

.github/workflows/
├── ci.yml                       # 新規: PR 時の typecheck / test / codegen 差分
├── deploy.yml                   # 新規: master → production デプロイ
└── deploy-preview.yml           # 新規: PR → preview デプロイ

scripts/post-merge.sh            # 変更: db push の削除
replit.md                        # 変更: 所有権ルール、スタック情報の更新
.gitignore                       # 変更: .wrangler/ を追加
```

---

### Task 1: api-worker パッケージの骨格

**Files:**
- Create: `artifacts/api-worker/package.json`
- Create: `artifacts/api-worker/tsconfig.json`
- Create: `artifacts/api-worker/wrangler.jsonc`
- Create: `artifacts/api-worker/src/index.ts`
- Modify: `.gitignore`

- [ ] **Step 1: package.json を作成**

`artifacts/api-worker/package.json`:

```json
{
  "name": "@workspace/api-worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "cf-typegen": "wrangler types",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@workspace/api-zod": "workspace:*"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: hono と wrangler を最新で追加**

```bash
pnpm --filter @workspace/api-worker add hono
pnpm --filter @workspace/api-worker add -D wrangler
```

Expected: `dependencies` に `hono`（4.12 以上）、`devDependencies` に `wrangler`（4 系）が入る。

- [ ] **Step 3: wrangler.jsonc を作成**

`artifacts/api-worker/wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "payroll-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-01",
  "observability": {
    "enabled": true
  }
}
```

D1 バインディングは Task 3 で、preview 環境は Task 6 で追加します。

- [ ] **Step 4: tsconfig.json を作成**

`artifacts/api-worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": [],
    "lib": ["es2022"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "worker-configuration.d.ts"],
  "references": [{ "path": "../../lib/api-zod" }]
}
```

Workers のランタイム型は `@types/node` ではなく `wrangler types` が生成する `worker-configuration.d.ts` で供給するため、`types` は空にします。

- [ ] **Step 5: Hono アプリの骨格を作成（ルートはまだ無し）**

`artifacts/api-worker/src/index.ts`:

```typescript
import { Hono } from "hono";

const app = new Hono().basePath("/api");

export default app;
```

- [ ] **Step 6: .gitignore に wrangler のローカル状態を追加**

ルートの `.gitignore` 末尾（`# Replit` セクションの後）に追記:

```text
# Cloudflare Workers
.wrangler/
```

- [ ] **Step 7: wrangler dev で起動確認**

```bash
pnpm --filter @workspace/api-worker exec wrangler dev --port 8787 &
sleep 8
curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/api/healthz
kill %1
```

Expected: `404`（アプリは起動するがルート未実装）。起動自体に失敗する場合は wrangler.jsonc の構文を確認します。

- [ ] **Step 8: typecheck**

```bash
pnpm run typecheck
```

Expected: エラーなしで完了。

- [ ] **Step 9: コミット**

```bash
git add artifacts/api-worker .gitignore pnpm-lock.yaml
git commit -m "feat(api-worker): Hono + wrangler による Workers API パッケージの骨格を追加"
```

---

### Task 2: vitest-pool-workers の導入と healthz の TDD 実装

**Files:**
- Modify: `artifacts/api-worker/package.json`
- Create: `artifacts/api-worker/vitest.config.ts`
- Create: `artifacts/api-worker/test/healthz.test.ts`
- Create: `artifacts/api-worker/src/routes/health.ts`
- Modify: `artifacts/api-worker/src/index.ts`

- [ ] **Step 1: vitest と pool-workers を追加**

```bash
pnpm --filter @workspace/api-worker add -D vitest@~3.2.0 @cloudflare/vitest-pool-workers
```

vitest を 3.2 系に固定するのは、`@cloudflare/vitest-pool-workers` の対応範囲が vitest 2.0〜3.2 のためです。

- [ ] **Step 2: test スクリプトを追加**

`artifacts/api-worker/package.json` の `scripts` に追加:

```json
"test": "vitest run"
```

- [ ] **Step 3: vitest.config.ts を作成**

`artifacts/api-worker/vitest.config.ts`:

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

- [ ] **Step 4: tsconfig に pool-workers の型を追加**

`artifacts/api-worker/tsconfig.json` の `compilerOptions.types` を変更:

```json
"types": ["@cloudflare/vitest-pool-workers"]
```

- [ ] **Step 5: 失敗するテストを書く**

`artifacts/api-worker/test/healthz.test.ts`:

```typescript
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { HealthCheckResponse } from "@workspace/api-zod";

describe("GET /api/healthz", () => {
  it("API 契約どおりの ok ステータスを返す", async () => {
    const res = await SELF.fetch("http://example.com/api/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(HealthCheckResponse.parse(body)).toEqual({ status: "ok" });
  });
});
```

`SELF` は wrangler.jsonc の `main` で指定した Worker 全体への統合テスト用フェッチャーです。レスポンスを `lib/api-zod` の生成スキーマで検証することで、OpenAPI 契約との一致をテストが保証します。

- [ ] **Step 6: テストを実行して失敗を確認**

```bash
pnpm --filter @workspace/api-worker run test
```

Expected: FAIL。`expect(res.status).toBe(200)` が 404 で失敗する。

- [ ] **Step 7: healthz ルートを実装**

`artifacts/api-worker/src/routes/health.ts`:

```typescript
import { Hono } from "hono";
import { HealthCheckResponse } from "@workspace/api-zod";

export const healthRoutes = new Hono().get("/healthz", (c) =>
  c.json(HealthCheckResponse.parse({ status: "ok" })),
);
```

`artifacts/api-worker/src/index.ts` を変更:

```typescript
import { Hono } from "hono";
import { healthRoutes } from "./routes/health.js";

const app = new Hono().basePath("/api");

app.route("/", healthRoutes);

export default app;
```

Express 版（`artifacts/api-server/src/routes/health.ts`）と同じく、レスポンスを Zod スキーマの `parse` に通してから返します。

- [ ] **Step 8: テストを実行して成功を確認**

```bash
pnpm --filter @workspace/api-worker run test
```

Expected: PASS（1 passed）。

- [ ] **Step 9: typecheck とコミット**

```bash
pnpm run typecheck
git add artifacts/api-worker pnpm-lock.yaml
git commit -m "feat(api-worker): healthz エンドポイントを契約検証付きで実装し vitest-pool-workers の統合テストを整備"
```

---

### Task 3: lib/db の D1 + Drizzle（SQLite 方言）転換

**Files:**
- Modify: `lib/db/package.json`
- Modify: `lib/db/drizzle.config.ts`
- Modify: `lib/db/tsconfig.json`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/.gitkeep`
- Modify: `artifacts/api-worker/wrangler.jsonc`（D1 バインディング追加）
- Modify: `artifacts/api-worker/package.json`（@workspace/db 依存追加）
- Modify: `artifacts/api-worker/vitest.config.ts`（マイグレーション適用）
- Create: `artifacts/api-worker/test/env.d.ts`
- Create: `artifacts/api-worker/test/apply-migrations.ts`
- Create: `artifacts/api-worker/worker-configuration.d.ts`（生成）
- Modify: `scripts/post-merge.sh`

- [ ] **Step 1: lib/db の依存を入れ替える**

```bash
pnpm --filter @workspace/db remove pg @types/pg
pnpm --filter @workspace/db add -D @cloudflare/workers-types
```

- [ ] **Step 2: lib/db の scripts を generate に変更**

`lib/db/package.json` の `scripts` を以下に置き換え（`push` / `push-force` は PostgreSQL の `drizzle-kit push` 用なので削除）:

```json
"scripts": {
  "generate": "drizzle-kit generate --config ./drizzle.config.ts"
}
```

- [ ] **Step 3: drizzle.config.ts を SQLite 方言に変更**

`lib/db/drizzle.config.ts` 全体を以下に置き換え:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});
```

`drizzle-kit generate` はスキーマ定義から SQL を生成するだけで DB 接続を必要としません。生成した SQL の適用は `wrangler d1 migrations apply` が担当するため、DB 認証情報はこの設定に不要です。

- [ ] **Step 4: lib/db/tsconfig.json の types を変更**

`"types": ["node"]` を以下に変更します。D1Database 型をグローバルに供給するためです。Node.js のグローバル型定義とは fetch 等で衝突するため、併用しません。

```json
"types": ["@cloudflare/workers-types"]
```

- [ ] **Step 5: 接続層を D1 ファクトリに書き換え**

`lib/db/src/index.ts` 全体を以下に置き換え:

```typescript
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/index.js";

export const createDb = (d1: D1Database) => drizzle(d1, { schema });
export type Db = ReturnType<typeof createDb>;

export * as schema from "./schema/index.js";
```

PostgreSQL 版はモジュールロード時に `Pool` を生成していましたが、Workers では D1 バインディングがリクエストコンテキスト（`c.env.DB`）経由で渡るため、ファクトリ関数にします。

- [ ] **Step 6: スキーマ雛形のコメントを SQLite 用に更新**

`lib/db/src/schema/index.ts` 全体を以下に置き換え:

```typescript
// テーブル定義は Phase 1 で追加します。定義パターン:
//
// import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
// import { createInsertSchema } from "drizzle-zod";
//
// export const employees = sqliteTable("employees", {
//   id: integer("id").primaryKey({ autoIncrement: true }),
//   name: text("name").notNull(),
// });
// export const employeeInsertSchema = createInsertSchema(employees);

export {};
```

- [ ] **Step 7: migrations ディレクトリを作成**

```bash
mkdir -p lib/db/migrations
touch lib/db/migrations/.gitkeep
```

- [ ] **Step 8: api-worker に D1 バインディングを追加**

`artifacts/api-worker/wrangler.jsonc` に追加（`observability` の後）:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "payroll-db",
    "database_id": "00000000-0000-0000-0000-000000000000",
    "migrations_dir": "../../lib/db/migrations"
  }
]
```

`database_id` は Task 6 で実物に差し替えるまでプレースホルダにします。`wrangler dev` と vitest-pool-workers はローカル SQLite を使うため、この値が偽物でもローカル開発・テストは動きます。

- [ ] **Step 9: api-worker に @workspace/db を追加し型を生成**

```bash
pnpm --filter @workspace/api-worker add "@workspace/db@workspace:*"
pnpm --filter @workspace/api-worker run cf-typegen
```

Expected: `artifacts/api-worker/worker-configuration.d.ts` が生成され、`Env` インターフェースに `DB: D1Database` が含まれる。このファイルはコミット対象です。CI の typecheck が再生成なしで通るようにするためです。

`artifacts/api-worker/tsconfig.json` の `references` に lib/db を追加:

```json
"references": [{ "path": "../../lib/api-zod" }, { "path": "../../lib/db" }]
```

`artifacts/api-worker/src/index.ts` の Hono に Bindings 型を付ける:

```typescript
const app = new Hono<{ Bindings: Env }>().basePath("/api");
```

- [ ] **Step 10: テスト基盤に D1 マイグレーション適用を組み込む**

`artifacts/api-worker/vitest.config.ts` 全体を以下に置き換え:

```typescript
import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "../../lib/db/migrations"),
  );
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
```

`artifacts/api-worker/test/env.d.ts`:

```typescript
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

`artifacts/api-worker/test/apply-migrations.ts`:

```typescript
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 11: post-merge.sh から PostgreSQL の push を削除**

`scripts/post-merge.sh` 全体を以下に置き換えます。D1 のマイグレーションは GitHub Actions のデプロイ時に適用するため、Replit のマージ後フックでは DB 操作をしません。

```bash
#!/bin/bash
set -e
pnpm install --frozen-lockfile
```

- [ ] **Step 12: テストと typecheck で全体を確認**

```bash
pnpm --filter @workspace/api-worker run test
pnpm run typecheck
```

Expected: テスト PASS（マイグレーション 0 件でもセットアップが通る）、typecheck エラーなし。

- [ ] **Step 13: マイグレーションのワークフローを通しで検証（コミットしない一時変更）**

スキーマに一時テーブルを書いて generate → apply → 確認 → 巻き戻しを行い、パイプライン全体が機能することを確かめます。

```bash
cat > /tmp/smoke-schema.ts <<'EOF'
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const smokeTest = sqliteTable("smoke_test", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note"),
});
EOF
cp /tmp/smoke-schema.ts lib/db/src/schema/index.ts
pnpm --filter @workspace/db run generate
ls lib/db/migrations/
pnpm --filter @workspace/api-worker exec wrangler d1 migrations apply payroll-db --local
pnpm --filter @workspace/api-worker exec wrangler d1 migrations list payroll-db --local
pnpm --filter @workspace/api-worker run test
```

Expected: `migrations/` に `0000_*.sql` が生成され、apply が成功し、list で適用済みになる。テストも PASS し、readD1Migrations がマイグレーションを拾って適用できることを確認できる。

確認後に巻き戻します:

```bash
git checkout -- lib/db/src/schema/index.ts
rm -rf lib/db/migrations/0000_* lib/db/migrations/meta
rm -rf artifacts/api-worker/.wrangler
git status --short
```

Expected: `git status` に lib/db のスキーマ・migrations の差分が残っていない。

- [ ] **Step 14: コミット**

```bash
git add lib/db artifacts/api-worker scripts/post-merge.sh pnpm-lock.yaml
git commit -m "feat(db): PostgreSQL から Cloudflare D1 (SQLite 方言) へ転換しマイグレーションワークフローを整備"
```

---

### Task 4: GitHub Actions の CI（PR 時の検証）

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: ci.yml を作成**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm run typecheck

      - name: Test
        run: pnpm -r --if-present run test

      - name: Codegen diff check
        run: |
          pnpm --filter @workspace/api-spec run codegen
          git diff --exit-code -- lib/api-client-react lib/api-zod
```

codegen 差分チェックは openapi.yaml と生成物の不整合（codegen 実行漏れや生成物の手編集）を検知します。openapi.yaml が変わらないときは差分ゼロで通るため、毎 PR で実行します。

- [ ] **Step 2: ローカルで CI と同じ手順を再現して確認**

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm -r --if-present run test
pnpm --filter @workspace/api-spec run codegen
git diff --exit-code -- lib/api-client-react lib/api-zod
```

Expected: すべて成功。codegen で差分が出る場合は orval のバージョン差異が原因なので、生成物を再コミットしてから進めます。

- [ ] **Step 3: コミット**

```bash
git add .github/workflows/ci.yml lib/api-client-react lib/api-zod
git commit -m "ci: PR 時の typecheck・テスト・codegen 差分チェックを追加"
```

codegen 再実行で差分が出なかった場合、`lib/` の add は空振りで問題ありません。

---

### Task 5: replit.md の所有権ルールとスタック情報の更新

**Files:**
- Modify: `replit.md`

Replit Agent は replit.md を作業指針として読むため、ここに書く所有権ルールがエンジニア領域を守るガードレールになります。**この変更内容は PR レビューの形で PdM に共有し、合意を得ます。**

- [ ] **Step 1: Stack セクションを現状に合わせて更新**

`replit.md` の `## Stack` 内、以下の 2 行を変更します。

変更前:

```markdown
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
```

変更後:

```markdown
- **API framework**: Hono on Cloudflare Workers (`artifacts/api-worker`). The legacy Express 5 scaffold (`artifacts/api-server`) is frozen and will be removed
- **Database**: Cloudflare D1 (SQLite) + Drizzle ORM
```

- [ ] **Step 2: Directory Ownership セクションを追加**

`## Overview` セクションの直後に追加:

```markdown
## Directory Ownership — IMPORTANT

To avoid conflicts between the Replit Agent (PdM) and engineers, each area has a single owner. **The Replit Agent must NOT modify files outside its own area.**

| Area | Owner | Rule for Replit Agent |
| --- | --- | --- |
| `artifacts/payroll-app`, `artifacts/mockup-sandbox`, `attached_assets` | PdM (Replit) | Free to modify |
| `artifacts/api-worker`, `artifacts/api-server`, `lib/db`, `lib/payroll-core`, `scripts`, `.github` | Engineers | Do NOT modify |
| `lib/api-spec/openapi.yaml` | Shared (PR required) | Do NOT modify directly; propose changes to engineers instead |
| `lib/api-client-react`, `lib/api-zod` | Generated by Orval | Do NOT edit by hand |

The API contract (`lib/api-spec/openapi.yaml`) is the single source of truth shared by both sides. Any change to it must go through a pull request reviewed by both PdM and engineers.
```

`lib/payroll-core` は Phase 2 で作成予定のパッケージですが、Replit Agent が先回りで同名ディレクトリを作らないよう先に明記します。

- [ ] **Step 3: lib/db セクションの記述を D1 に合わせて更新**

`### lib/db` セクションの本文を以下に置き換え:

```markdown
Database layer using Drizzle ORM with Cloudflare D1 (SQLite dialect). Exports a `createDb(d1)` factory and schema models.

- `src/index.ts` — `createDb(d1: D1Database)` factory returning a Drizzle instance
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no model definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (`dialect: sqlite`, no DB credentials needed)
- `migrations/` — SQL migrations generated by `pnpm --filter @workspace/db run generate`

Migrations are applied by GitHub Actions on deploy (`wrangler d1 migrations apply`), not from Replit.
```

- [ ] **Step 4: api-worker セクションを Packages に追加**

`### artifacts/api-server` セクションの直前に追加:

```markdown
### `artifacts/api-worker` (`@workspace/api-worker`)

Hono API running on Cloudflare Workers. This is the production API; `api-server` (Express) is a frozen legacy scaffold. **Engineer-owned: the Replit Agent must not modify this package.**

- Entry: `src/index.ts` — Hono app with `basePath("/api")`
- Routes: `src/routes/health.ts` exposes `GET /healthz` (full path: `/api/healthz`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-worker run dev` — local dev server via `wrangler dev` (local D1 included)
- `pnpm --filter @workspace/api-worker run test` — integration tests via `@cloudflare/vitest-pool-workers`
```

- [ ] **Step 5: コミット**

```bash
git add replit.md
git commit -m "docs(replit): ディレクトリ所有権ルールを明記し D1 転換後のスタック情報へ更新"
```

---

### Task 6: Cloudflare リソース作成とデプロイワークフロー

**Files:**
- Modify: `artifacts/api-worker/wrangler.jsonc`（実 database_id と preview 環境）
- Create: `.github/workflows/deploy.yml`
- Create: `.github/workflows/deploy-preview.yml`

> **ユーザー実施項目を含むタスクです。** Step 1〜2（Cloudflare 認証と D1 作成）、Step 6（GitHub Secrets 設定）はアカウント権限が必要なため、エージェントが代行できない場合はユーザーに依頼します。

- [ ] **Step 1: Cloudflare にログイン（ユーザー実施）**

```bash
pnpm --filter @workspace/api-worker exec wrangler login
pnpm --filter @workspace/api-worker exec wrangler whoami
```

Expected: `whoami` でアカウント名と Account ID が表示される。Account ID は Step 6 で使うため控えます。

- [ ] **Step 2: D1 データベースを production / preview の 2 つ作成**

```bash
pnpm --filter @workspace/api-worker exec wrangler d1 create payroll-db
pnpm --filter @workspace/api-worker exec wrangler d1 create payroll-db-preview
```

Expected: それぞれ `database_id`（UUID）が出力される。両方控えます。

- [ ] **Step 3: wrangler.jsonc に実 ID と preview 環境を設定**

`artifacts/api-worker/wrangler.jsonc` の `d1_databases.database_id` を payroll-db の実 UUID に差し替え、トップレベルに `env` を追加します（バインディングは環境間で継承されないため、preview 側にも明示的に定義します）:

```jsonc
"env": {
  "preview": {
    "name": "payroll-api-preview",
    "d1_databases": [
      {
        "binding": "DB",
        "database_name": "payroll-db-preview",
        "database_id": "<payroll-db-preview の UUID>",
        "migrations_dir": "../../lib/db/migrations"
      }
    ],
    "observability": {
      "enabled": true
    }
  }
}
```

- [ ] **Step 4: deploy.yml（production）を作成**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy (production)

on:
  push:
    branches: [master]
    paths:
      - "artifacts/api-worker/**"
      - "lib/db/**"
      - "lib/api-spec/**"
      - "lib/api-zod/**"
      - ".github/workflows/deploy.yml"

concurrency: deploy-production

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Apply D1 migrations and deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: artifacts/api-worker
          preCommands: pnpm exec wrangler d1 migrations apply payroll-db --remote
          command: deploy
```

paths フィルタにより、Replit Agent によるフロントエンドのみのコミットではデプロイが走りません。

- [ ] **Step 5: deploy-preview.yml を作成**

`.github/workflows/deploy-preview.yml`:

```yaml
name: Deploy (preview)

on:
  pull_request:
    paths:
      - "artifacts/api-worker/**"
      - "lib/db/**"
      - "lib/api-spec/**"
      - "lib/api-zod/**"
      - ".github/workflows/deploy-preview.yml"

concurrency: deploy-preview

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Apply D1 migrations and deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: artifacts/api-worker
          preCommands: pnpm exec wrangler d1 migrations apply payroll-db-preview --env preview --remote
          command: deploy --env preview
```

preview 環境は PR ごとに同じ Worker（payroll-api-preview）を上書きします。同時に複数 PR を検証する運用になったら PR 番号別の環境分離を検討しますが、現状の体制では不要です。

- [ ] **Step 6: GitHub Secrets を設定（ユーザー実施）**

Cloudflare ダッシュボード → My Profile → API Tokens で「Edit Cloudflare Workers」テンプレートからトークンを作成し、Permissions に **D1: Edit** を追加します。作成したトークンと Step 1 の Account ID を設定します:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

- [ ] **Step 7: typecheck・テストの最終確認とコミット**

```bash
pnpm run typecheck
pnpm --filter @workspace/api-worker run test
git add artifacts/api-worker/wrangler.jsonc .github/workflows/deploy.yml .github/workflows/deploy-preview.yml
git commit -m "ci: Workers の preview / production デプロイワークフローと D1 接続設定を追加"
```

- [ ] **Step 8: デプロイの動作確認**

PR マージ後（または手動で `wrangler deploy` 実行後）に確認します:

```bash
curl -s https://payroll-api.<アカウントのサブドメイン>.workers.dev/api/healthz
```

Expected: `{"status":"ok"}`。

> 注意: この時点では Worker は認証なしで公開されます。ダミーデータしか扱わない Phase 0〜3 の間は許容し、Cloudflare Access の保護は親計画どおり Phase 3 で導入します（実データ投入前に必須）。

---

## 完了条件

- [ ] `pnpm --filter @workspace/api-worker run dev` でローカル起動し、`/api/healthz` が契約どおりのレスポンスを返す
- [ ] `pnpm --filter @workspace/api-worker run test` が D1 バインディング込みで通る
- [ ] `pnpm run typecheck` がルートから通る
- [ ] PR を作ると CI（typecheck / test / codegen 差分）と preview デプロイが走る
- [ ] master マージで production デプロイと D1 マイグレーション適用が走る
- [ ] replit.md の所有権ルールについて PdM の合意が取れている
