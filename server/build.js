//  Copies the game into dist/public, the directory Cloudflare publishes
//  (wrangler.jsonc runs this before `wrangler dev` and `wrangler deploy`).
//  The game itself needs no build: this only decides what is public.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'public');
mkdirSync(OUT, { recursive: true });
copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));
console.log('server/build.js: index.html → dist/public/');
