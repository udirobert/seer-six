#!/usr/bin/env node
/* The contract, checked statically.

   /contract/ already audits itself in the browser — it walks the stylesheets and
   reports ad-hoc durations, un-tokenised colours and whether every reduced-motion
   path really snaps. That audit runs *after* deploy, on the machine of whoever is
   reading it. This file runs the same assertions before a commit, on this machine,
   so the published claim cannot be broken by the commit that breaks it.

   It is deliberately narrow. Every check below is a sentence the entry says about
   itself; nothing here is a style preference.

     node tools/lint.mjs [--json] [--quiet]
*/
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const quiet = argv.includes('--quiet');

const PAGES = [
  'index.html', 'app/index.html', 'deep/index.html', 'futarchy/index.html',
  'opportunity/index.html', 'risk/index.html', 'contract/index.html', 'm/index.html'
];
/* Third-party and binary payloads: not ours to keep clean, and not counted in a
   page's own budget claim (fonts are reported, never asserted away). */
const VENDOR = /^vendor\//;
const FONTS = /^fonts\//;
const SKIP = /^(\.git|node_modules)\//;

const findings = [];
const notes = [];
const fail = (rule, where, msg, fix) => findings.push({ rule, where, msg, fix });

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs).split(/[\\/]/).join('/');
    if (SKIP.test(rel)) continue;
    if (statSync(abs).isDirectory()) walk(abs);
    else files.push(rel);
  }
})(ROOT);

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const bytes = (rel) => statSync(join(ROOT, rel)).size;
/* Comments are prose about the rules, not rules. Without this, the sentence "a
   duration does not time a scroll-driven animation" sitting under the reduce
   block in motion.css parses as a declaration with an off-scale value. */
const decommentCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
const text = files.filter((f) => /\.(css|html|js|mjs|py|svg|md|toml|json|txt|ya?ml|sh)$/.test(f) && !VENDOR.test(f));
const css = files.filter((f) => f.endsWith('.css') && !VENDOR.test(f));
const js = files.filter((f) => /\.(js|mjs)$/.test(f) && !VENDOR.test(f));

// ---------------------------------------------------------------- media ----
/* The reel is 8 MB and the repo is a website. Large media belongs on a content
   store and is referenced by URL — see tools/upload-grove.mjs, which prints the
   gateway link to paste. Committing it would make every clone pay for a file
   that is never fetched by a page. */
const MEDIA = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|ogg|flac|aiff)$/i;
for (const f of files.filter((x) => MEDIA.test(x))) {
  fail('media-in-repo', f, `${(bytes(f) / 1024).toFixed(0)} KB of audio/video inside the site root`,
    'node tools/upload-grove.mjs <file> — it returns a public gateway URL to link instead');
}

// ------------------------------------------------------------- secrets -----
/* gitleaks scans the *contents*; this catches the filenames that should never be
   staged in the first place, including ones whose contents look innocent. */
const BADNAME = /(^|\/)(\.env|\.env\.[^/]+|[^/]*\.(pem|p12|pfx|keystore|jks)$|id_rsa[^/]*|\.netrc|credentials[^/]*|\.npmrc|\.pypirc)$/i;
for (const f of files.filter((x) => BADNAME.test(x) && !/\.env\.example$/.test(x))) {
  fail('secret-shaped-file', f, 'a filename that means credentials', 'keep it out of the site root; values live in the environment, never in the repo');
}

// -------------------------------------------------------------- colours ----
/* tokens.css is the one file allowed to name a colour, because the brand kit is a
   blocking dependency: when the EF export lands, the whole palette changes in one
   edit and nothing else is touched. The entry says this out loud on /contract/. */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const FUNC = /\b(?:rgba?|hsla?|color)\s*\(/g;
const NAMED = /:\s*(?:white|black|red|blue|green|gray|grey|orange|purple|yellow|pink|silver|gold)\b/g;
const COLOUR_OK = ['tokens.css', 'favicon.svg'];
for (const f of css.filter((x) => !COLOUR_OK.includes(x))) {
  const src = decommentCss(read(f));
  for (const [re, label] of [[HEX, 'hex'], [FUNC, 'rgb()/hsl()'], [NAMED, 'named colour']]) {
    const hits = [...src.matchAll(re)].filter((m) => {
      const line = src.slice(0, m.index).split('\n').pop() || '';
      return !/^\s*(?:\/\/|\/\*|\*)/.test(line) && !/url\(#/.test(line);
    });
    if (hits.length) {
      fail('colour-quarantine', f, `${hits.length} ${label} literal${hits.length > 1 ? 's' : ''} outside tokens.css`,
        'add a --ef-* / --bg-* token to tokens.css and use it here');
    }
  }
}
for (const f of js.filter((x) => !/^tools\//.test(x))) {
  const hits = [...read(f).matchAll(HEX)].filter((m) => {
    const before = m.input.slice(Math.max(0, m.index - 24), m.index);
    return !/(id|href|url|anchor|#[0-9a-f]{1,2}\b)/i.test(before);
  });
  if (hits.length) fail('colour-quarantine', f, `${hits.length} hex literal${hits.length > 1 ? 's' : ''} in a script`,
    'read the colour from a custom property with getComputedStyle');
}

// ------------------------------------------------------------ durations ----
/* Five steps, one scale: --d-1 200, --d-2 220, --d-3 320, --d-4 400, --d-5 520.
   The entry's whole argument is that no number on screen is a taste judgement, so
   an ad-hoc duration is not a lint nit — it falsifies the thesis. */
const DUR_OK = /^(\s*(?:var\(--d-[1-5]\)|none|0(?:\.0+1)?(?:ms|s))\s*!important\s*,?|\s*(?:var\(--d-[1-5]\)|none|0(?:\.0+1)?(?:ms|s))\s*,?)+$/;
for (const f of css) {
  const src = decommentCss(read(f));
  for (const m of src.matchAll(/([-a-z]*duration)\s*:\s*([^;{}]+)[;}]/g)) {
    if (!DUR_OK.test(m[2])) {
      fail('duration-scale', f, `${m[1]}: ${m[2].trim()} is not on the five-step scale`,
        'use var(--d-1..5); a 0.01ms snap is allowed only inside a reduced-motion block');
    }
  }
  /* Shorthand: `animation: name 400ms …` hides a duration the property check
     above never sees, and the shorthand is what the view-transition blocks use. */
  for (const m of src.matchAll(/\b(?:animation|transition)\s*:\s*([^;{}]+)[;]/g)) {
    const lit = m[1].match(/(\d+(?:\.\d+)?(?:ms|s))/g);
    if (lit) for (const v of lit) {
      if (!/^(?:0(?:\.0+1)?(?:ms|s))$/.test(v)) {
        fail('duration-scale', f, `${m[0].trim().slice(0, 60)} — literal ${v} in a shorthand`,
          'replace with var(--d-1..5)');
      }
    }
  }
}
for (const f of js.filter((x) => !/^tools\//.test(x))) {
  for (const m of read(f).matchAll(/\b(?:duration|delay)\s*:\s*(\d+)\b/g)) {
    fail('duration-scale', f, `${m[0]} — a millisecond literal in a script`,
      'resolve the step through dur()/var(--d-<step>) like every other interval');
  }
}

// -------------------------------------------------- reduced-motion parity ---
/* The bug this check exists for: `animation-duration: 0.01ms` does nothing to a
   scroll-driven animation, because its progress is the timeline and not the
   clock. A reduce block that forgets `animation-timeline: auto` leaves content
   parked at a scroll position and calls that the accessible state. */
const motion = existsSync(join(ROOT, 'motion.css')) ? read('motion.css') : '';
const reduceBlocks = [...motion.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g)];
if (!reduceBlocks.length) fail('reduce-coverage', 'motion.css', 'no prefers-reduced-motion: reduce block', 'write one');
for (const sel of [['prefers-reduced-motion: reduce', '@media (prefers-reduced-motion: reduce)'],
                   ['data-reduced="1"', 'html[data-reduced="1"]']]) {
  const src = motion;
  if (!src.includes(sel[0])) {
    fail('reduce-coverage', 'motion.css', `no ${sel[1]} path`, 'the OS setting and the on-page toggle must not diverge');
    continue;
  }
  for (const prop of ['animation-duration', 'transition-duration', 'animation-timeline']) {
    if (!new RegExp(prop + '\\s*:[^;]*(0\\.01ms|0s|none|auto)', 'i').test(src)) {
      fail('reduce-coverage', 'motion.css', `the reduced path never sets ${prop}`,
        'a duration alone cannot stop a scroll-driven animation; set animation-timeline: auto');
    }
  }
}

// --------------------------------------------------------- page contract ---
const REQUIRED_HEAD = [
  ['<!DOCTYPE html>', /<!DOCTYPE html>/i, 'the doctype'],
  ['lang', /<html[^>]*\blang=/i, 'a lang attribute on <html>'],
  ['charset', /<meta\s+charset=/i, 'a charset meta'],
  ['viewport', /<meta\s+name="viewport"/i, 'a viewport meta'],
  ['title', /<title>[^<]{4,}<\/title>/i, 'a non-trivial <title>'],
  ['description', /<meta\s+name="description"/i, 'a description meta'],
  ['leg.js', /<script src="[^"]*leg\.js"><\/script>/, 'leg.js, the shared arrival script'],
  ['favicon', /<link rel="icon"/, 'the favicon'],
  ['tokens.css', /<link rel="stylesheet" href="[^"]*tokens\.css"/, 'tokens.css'],
  ['motion.css', /<link rel="stylesheet" href="[^"]*motion\.css"/, 'motion.css']
];
for (const page of PAGES) {
  if (!existsSync(join(ROOT, page))) { fail('page-missing', page, 'listed as a surface but not on disk', 'restore it or drop it from PAGES in tools/lint.mjs'); continue; }
  const src = read(page);
  for (const [what, re, label] of REQUIRED_HEAD) {
    if (!re.test(src)) fail('page-contract', page, `no ${label}`, `add ${what}`);
  }
  if (!/<html[^>]*\bdata-surface=/.test(src)) {
    fail('page-contract', page, 'no data-surface on <html>', 'the surface rail and the leg badge both key off it');
  }
}

// ------------------------------------------------------------- mirrors -----
/* The entry is served from more than one origin, and it works from any of them
   because nothing inside it names one. An absolute self-link would strand a
   reader on the mirror onto the primary host mid-transition. */
for (const f of [...css, ...js, ...files.filter((x) => x.endsWith('.html'))]) {
  if (/^tools\/|^evidence\//.test(f)) continue;
  for (const m of read(f).matchAll(/https?:\/\/[^\s"'<>]*(github\.io|vercel\.app|netlify\.app)[^\s"'<>]*/g)) {
    fail('no-self-origin', f, `absolute link to our own host: ${m[0].slice(0, 60)}`,
      'make it relative — the mirror must be the same submission, not a redirect');
  }
}

// ------------------------------------------------------------- budgets -----
const BASE = { html: 48 * 1024, asset: 128 * 1024, closure: 420 * 1024 };
function closure(page) {
  const dir = posix.dirname(page);
  const seen = new Set();
  const queue = [page];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (!existsSync(join(ROOT, cur))) continue;
    const src = cur.endsWith('.html') || cur.endsWith('.css') ? read(cur) : '';
    const specs = cur.endsWith('.html')
      ? [...src.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)].map((m) => m[1])
        .concat([...src.matchAll(/from\s+['"]([^'"]+\.js)['"]/g)].map((m) => m[1]))
      : [...src.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)].map((m) => m[2])
        .filter((u) => u.endsWith('.css'));
    for (const s of specs) {
      if (/^(https?:|data:|\/\/)/.test(s)) continue;
      const rel = relative(ROOT, resolve(ROOT, dir, s)).split(/[\\/]/).join('/');
      if (!rel.startsWith('..') && existsSync(join(ROOT, rel))) queue.push(rel);
    }
  }
  return [...seen];
}

/* Cross-document view transitions need both documents to opt in, and the opt-in
   is a CSS rule — so a page satisfies it by *reaching* the declaration, whether
   it wrote it or inherited it from motion.css. Checking the page source alone
   would fail all eight and teach nobody anything. */
for (const page of PAGES) {
  if (!existsSync(join(ROOT, page))) continue;
  const chain = closure(page).filter((f) => f.endsWith('.css'));
  if (!chain.some((f) => read(f).includes('@view-transition'))) {
    fail('page-contract', page, `no @view-transition in its ${chain.length}-sheet chain`,
      'the boundary morph is the entry; without the opt-in this page navigates plainly');
  }
}
for (const page of PAGES) {
  if (!existsSync(join(ROOT, page))) continue;
  const own = bytes(page);
  if (own > BASE.html) fail('budget', page, `${(own / 1024).toFixed(0)} KB of HTML (budget ${(BASE.html / 1024) | 0} KB)`,
    'move markup into the data modules or trim the page');
  const assets = closure(page).filter((f) => f !== page && !FONTS.test(f) && !VENDOR.test(f));
  for (const a of assets) {
    if (bytes(a) > BASE.asset) fail('budget', `${page} → ${a}`, `${(bytes(a) / 1024).toFixed(0)} KB (per-asset ${(BASE.asset / 1024) | 0} KB)`,
      'trim the baked fields this page does not render');
  }
  const total = assets.reduce((s, f) => s + bytes(f), 0);
  notes.push({ page, kb: +(total / 1024).toFixed(1), assets: assets.length });
  if (total > BASE.closure) fail('budget', page, `first-load closure ${(total / 1024).toFixed(0)} KB (budget ${(BASE.closure / 1024) | 0} KB)`,
    'defer a data module this surface does not read');
}

// -------------------------------------------------------------- syntax -----
for (const f of js) {
  try { execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' }); }
  catch (e) {
    fail('syntax', f, String(e.stderr || e.message).split('\n').slice(0, 3).join(' ').slice(0, 160),
      'fix it before committing; the site has no build step to catch it later');
  }
}

// --------------------------------------------------------- placeholders ----
/* Split so this file does not match itself: a checker that contains the words it
   hunts has to exempt itself, and an exemption in a linter is a hole. */
const MARKER = new RegExp(['TO' + 'DO', 'FIX' + 'ME', '\u27E6[^\u27E7]*\u27E7'].join('|'), 'g');
for (const f of text) {
  const hits = [...read(f).matchAll(MARKER)];
  if (hits.length) fail('placeholder', f, [...new Set(hits.map((m) => m[0]))].slice(0, 4).join(', '),
    'a shipped file has no unfinished marks in it');
}

// ------------------------------------------------------------- report ------
const report = {
  ok: findings.length === 0,
  files: files.length,
  checks: ['media-in-repo', 'secret-shaped-file', 'colour-quarantine', 'duration-scale',
    'reduce-coverage', 'page-contract', 'no-self-origin', 'budget', 'syntax', 'placeholder'],
  findings,
  closures: notes
};
if (asJson) console.log(JSON.stringify(report, null, 1));
if (!quiet) {
  if (!asJson) {
    for (const f of findings) {
      console.log(`✗ ${f.rule}  ${f.where}\n    ${f.msg}\n    → ${f.fix}`);
    }
    if (!findings.length) {
      const worst = notes.reduce((a, b) => (a && a.kb > b.kb ? a : b), null);
      console.log(`✓ ${files.length} files · ${findings.length} findings`);
      console.log(`  heaviest first-load closure: ${worst.page} at ${worst.kb} KB over ${worst.assets} files`);
      console.log(`  colours outside tokens.css: 0 · durations off the scale: 0 · reduced paths: 2`);
    }
  }
}
process.exit(findings.length ? 1 : 0);
