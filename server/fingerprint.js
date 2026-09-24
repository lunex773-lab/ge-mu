//  ============================================================
//  CONTOUR — which build of the room server this is
//  ============================================================
//  A fingerprint of every file the room server runs (server/, shared/, and
//  the lab's core it imports). server/build.js writes it into the Worker
//  (dist/build.js) and the room says it in every welcome ('bd'), so the
//  live check (server/test/room.test.js) can tell a room still running the
//  last version — the minute after a deploy, while Cloudflare moves the
//  rooms over — from the one it has just deployed, and wait for the new.
//  Node only (the build and the tests run it; the room only reads the result).

import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const DIRS = ['server', 'shared', 'lab/core', 'lab/adapter'];
const NOT = new Set(['server/build.js', 'server/fingerprint.js']);

export function fingerprint(root) {
  const h = createHash('sha256');
  for (const d of DIRS) {
    for (const f of readdirSync(path.join(root, d)).filter((n) => n.endsWith('.js')).sort()) {
      const rel = d + '/' + f;
      if (NOT.has(rel)) continue;
      h.update(rel + '\n' + readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n') + '\n');
    }
  }
  return h.digest('hex').slice(0, 12);
}
