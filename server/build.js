//  Copies the game into dist/public, the directory Cloudflare publishes
//  (wrangler.jsonc runs this before `wrangler dev` and `wrangler deploy`).
//  The game itself needs no build: this only decides what is public. It also
//  writes dist/build.js, the fingerprint of the room server's code, which the
//  room says in every welcome (server/fingerprint.js).
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fingerprint } from './fingerprint.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'public');
mkdirSync(OUT, { recursive: true });
copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));
const bd = fingerprint(ROOT);
writeFileSync(path.join(ROOT, 'dist', 'build.js'), 'export default ' + JSON.stringify(bd) + ';\n');
console.log('server/build.js: index.html → dist/public/; room server build ' + bd);
