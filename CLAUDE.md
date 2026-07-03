# Payroll-Admin

給与・勤怠管理 SaaS のモノレポ。pnpm workspaces + TypeScript composite projects で構成されています。

## Stack

- **Runtime**: Node.js 24 / pnpm（npm・yarn は preinstall hook でブロック）
- **Language**: TypeScript 5.9（`tsconfig.base.json` で composite + bundler resolution）
- **API**: Express 5 + Zod v4 バリデーション
- **DB**: PostgreSQL + Drizzle ORM
- **Frontend**: React 19 + Vite + Radix UI + Tailwind CSS 4
- **Codegen**: Orval（OpenAPI → React Query hooks / Zod schemas）
- **Build**: esbuild（API server）、Vite（frontend）

## Commands

```bash
# 型チェック（ルートから実行必須。パッケージ単体では依存の .d.ts が未ビルドで失敗する）
pnpm run typecheck

# 全パッケージビルド（typecheck → 再帰 build）
pnpm run build

# API サーバー開発
pnpm --filter @workspace/api-server run dev

# フロントエンド開発
pnpm --filter @workspace/payroll-app run dev

# OpenAPI codegen（api-spec → api-client-react / api-zod）
pnpm --filter @workspace/api-spec run codegen

# DB スキーマ反映
pnpm --filter @workspace/db run push
```

## Structure

```
├── artifacts/
│   ├── api-server/          # Express 5 API サーバー
│   ├── payroll-app/         # 給与管理 React アプリ
│   └── mockup-sandbox/      # UI モックアップ（他パッケージ非依存）
├── lib/
│   ├── api-spec/            # OpenAPI 定義 + Orval codegen 設定
│   ├── api-client-react/    # 生成済み React Query hooks
│   ├── api-zod/             # 生成済み Zod schemas
│   └── db/                  # Drizzle ORM スキーマ・接続
├── scripts/                 # ユーティリティスクリプト
├── rdra/                    # RDRA 要求分析ドキュメント
├── docs/plans/              # 設計計画書
└── plugins/rdra-analysis/   # RDRA 分析 Claude プラグイン
```

## Packages

### `artifacts/api-server`

Express 5 API サーバー。`src/routes/` にルート定義、`@workspace/api-zod` でバリデーション、`@workspace/db` で永続化。エントリは `src/index.ts`、ルートマウントは `/api`。

### `artifacts/payroll-app`

給与・勤怠管理の React SPA。wouter でルーティング、react-hook-form でフォーム管理、jspdf + html2canvas で PDF エクスポート。

### `artifacts/mockup-sandbox`

スタンドアロンの UI モックアップ環境。他の workspace パッケージへの依存なし。

### `lib/api-spec`

OpenAPI 3.1 仕様（`openapi.yaml`）と Orval 設定。`codegen` で `api-client-react` と `api-zod` を生成。

### `lib/db`

Drizzle ORM のスキーマ定義と DB 接続。`drizzle.config.ts` に `DATABASE_URL` が必要。

## TypeScript

ルート `tsconfig.json` が全パッケージを project references で束ねています。型チェックは必ずルートから `pnpm run typecheck` で実行してください。`tsc --build --emitDeclarationOnly` で `.d.ts` のみ出力し、JS バンドルは esbuild/Vite が担当します。

## Domain Knowledge

`.agents/memory/` に給与計算ドメインの重要な知識が蓄積されています（時給計算モデル、割増賃金、所得税、健保料率、賞与計算など）。給与ロジックを変更する際は参照してください。
