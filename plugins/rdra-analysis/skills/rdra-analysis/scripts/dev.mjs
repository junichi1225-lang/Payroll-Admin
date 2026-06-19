#!/usr/bin/env node
// rdra/ ディレクトリを配信し、index.html の変更を SSE でブラウザに通知する開発サーバー。
// npm 依存なし。Node 標準機能のみで動く。
//
// 使い方:
//   node dev.mjs <rdra/ のパス> [ポート]

import { createServer } from 'node:http';
import { readFileSync, watch, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const dir = resolve(process.argv[2] || '.');
const port = parseInt(process.argv[3] || '3000', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const clients = new Set();

watch(dir, { recursive: true }, (_event, filename) => {
  if (filename && filename.endsWith('.html')) {
    for (const res of clients) {
      res.write('data: reload\n\n');
    }
  }
});

const server = createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(':\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const file = req.url === '/' ? '/index.html' : req.url;
  const path = join(dir, decodeURIComponent(file));

  if (!path.startsWith(dir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(path)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  try {
    const content = readFileSync(path);
    const ext = extname(path);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end('Internal server error');
  }
});

server.listen(port, () => {
  console.log(`開発サーバー起動: http://localhost:${port}`);
  console.log(`配信ディレクトリ: ${dir}`);
  console.log('Ctrl+C で終了');
});
