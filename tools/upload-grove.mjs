#!/usr/bin/env node
/* Put a large asset where large assets belong, and get back a permanent link.

   The reel is 8 MB and the repo is a website; the pre-commit gate refuses media
   inside the site root (see tools/lint.mjs, rule `media-in-repo`). This is the
   other half of that rule: Grove (Lens storage) takes the file, returns a
   `lens://` URI plus a plain HTTPS gateway URL, and the entry links the URL.

   No credentials. The one-step upload is unauthenticated by design — content is
   immutable and publicly readable the moment it lands — so there is no key to
   leak and nothing to rotate. Which is also the warning:

     anything you upload here is public and cannot be deleted by you.

   Usage:
     node tools/upload-grove.mjs <file> [--chain=232] [--record=<path.json>]

   --chain selects the retention policy the immutable ACL inherits. 232 is Lens
   mainnet; the docs warn testnet content may be reaped, so the default is not a
   preference, it is the difference between a link that outlives the bounty and
   one that does not.
*/
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const ENDPOINT = 'https://api.grove.storage';
const MAX_BYTES = 125 * 1024 * 1024;
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.json': 'application/json'
};

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const file = argv.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node tools/upload-grove.mjs <file> [--chain=232] [--record=<path.json>]');
  process.exit(2);
}
const abs = resolve(file);
if (!existsSync(abs)) { console.error(`no such file: ${abs}`); process.exit(2); }

const ext = extname(abs).toLowerCase();
const type = MIME[ext];
const size = statSync(abs).size;
if (!type) { console.error(`unmapped extension ${ext} — add it to MIME or pass a type you mean`); process.exit(2); }
if (size > MAX_BYTES) { console.error(`${basename(abs)} is ${(size / 1048576).toFixed(1)} MB; Grove's ceiling is 125 MB`); process.exit(2); }

const chain = flag('chain', '232');
console.log(`${basename(abs)} · ${(size / 1048576).toFixed(2)} MB · ${type} · chain_id=${chain}`);
console.log('  uploading now — this is the irreversible step: public, immutable, not deletable by you.');

const buf = readFileSync(abs);
const t0 = Date.now();
const res = await fetch(`${ENDPOINT}/?chain_id=${chain}`, {
  method: 'POST', body: buf, headers: { 'content-type': type }
});
const body = await res.text();
if (!res.ok && res.status !== 201 && res.status !== 202) {
  console.error(`✗ ${res.status} ${res.statusText}\n${body.slice(0, 800)}`);
  process.exit(1);
}
let out;
try { out = JSON.parse(body); } catch { console.error(`✗ unreadable response:\n${body.slice(0, 400)}`); process.exit(1); }
/* The docs show the one-step response as an object and the multipart one as an
   array. The API returns an array for both; reading `.uri` off it yields
   undefined and prints a confident link to nothing. */
if (Array.isArray(out)) out = out[0];
if (!out || !out.gateway_url) { console.error(`✗ no gateway_url in the response:\n${body.slice(0, 400)}`); process.exit(1); }

/* 201 means it is already on the storage layer; 202 means the edge accepted it
   and propagation is asynchronous. Both are documented as immediately
   downloadable, and a link you have not fetched is not a link — so wait on the
   status endpoint and then re-GET the gateway URL and compare the byte count
   before reporting success. */
let ready = null;
for (let i = 0; i < 20; i++) {
  try {
    const s = await (await fetch(out.status_url)).json();
    if (s.status === 'available') { ready = s; break; }
  } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 1500));
}
let served = 'NOT FETCHED';
if (ready) {
  try {
    const back = await fetch(out.gateway_url);
    const n = Number(back.headers.get('content-length') || 0);
    served = `${back.status}${n ? ` ${n} bytes` : ''}${n === size ? ' · byte-for-byte' : n ? ` ≠ ${size} sent` : ''}`;
    if (n && n !== size) served = `MISMATCH ${n} of ${size}`;
  } catch { /* leave NOT FETCHED */ }
}
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s · status ${ready ? ready.status : 'unknown'} · readback ${served}`);
console.log(`\nlens://    ${out.uri}`);
console.log(`gateway    ${out.gateway_url}`);
console.log(`storageKey ${out.storage_key}`);

if (flag('record', '')) {
  const p = resolve(flag('record'));
  const prev = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { assets: [] };
  prev.assets.push({
    file: basename(abs), bytes: size, type, chain_id: Number(chain),
    uri: out.uri, gateway_url: out.gateway_url, storage_key: out.storage_key,
    uploaded_at: new Date().toISOString(), readback: served
  });
  writeFileSync(p, JSON.stringify(prev, null, 1) + '\n');
  console.log(`\nrecorded → ${p}`);
}
