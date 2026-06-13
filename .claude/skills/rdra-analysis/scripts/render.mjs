#!/usr/bin/env node
// analysis.md を読み、自己完結 HTML テンプレートに埋め込んで index.html を生成する。
// npm 依存を持たず、Node の標準機能だけで動く。
//
// 使い方:
//   node render.mjs <analysis.md のパス> [出力する index.html のパス]
// 出力先を省略すると、analysis.md と同じディレクトリの index.html に書き出す。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const mdPath = process.argv[2];
if (!mdPath) {
  console.error('使い方: node render.mjs <analysis.md のパス> [index.html のパス]');
  process.exit(1);
}
const outPath = process.argv[3] || join(dirname(mdPath), 'index.html');
const templatePath = join(here, '..', 'assets', 'template.html');

const md = readFileSync(mdPath, 'utf8');
const template = readFileSync(templatePath, 'utf8');

// Markdown 内に </script> があるとテンプレートの script タグが途中で閉じてしまうため無害化する
const safe = md.replace(/<\/(script)/gi, '<\\/$1');

// 置換文字列に含まれる $ が特殊扱いされないよう、関数で置換する
const html = template.replace('__MARKDOWN_CONTENT__', () => safe);

writeFileSync(outPath, html, 'utf8');
console.log(`生成しました: ${outPath} (元: ${mdPath})`);
