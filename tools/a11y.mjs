#!/usr/bin/env node
/* Evidence for the claim printed on /contract/: that the motion carries
   information, and that the information outlives it. Every number in
   evidence/a11y.json is measured here, in Chromium, against a deployed URL —
   not asserted in prose.

     node tools/a11y.mjs [--url=https://udirobert.github.io/seer-six] [--no-shots]

   Two passes per (viewport, motion) pair: a cold load of each page, which is
   the degradation case (no previous document, so the browser must cut), and a
   click-walk along the real surface rail, which is the case the claim is about.
*/
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '..');
/* The harness lives inside the published tree on purpose: a judge can click
   from the claim on /contract/ to the numbers in /evidence/ to the code that
   measured them. Screenshots stay outside it — they are for us, not for a CDN. */
const OUT = join(ENTRY, 'evidence');
const SHOTS = resolve(ENTRY, '..', 'evidence', 'shots');
const AXE = join(ENTRY, 'vendor', 'axe.min.js');

/* Playwright is already on this machine in the npx cache; no install step, and
   nothing here writes to the published site. playwright-core is the variant on
   the Linux box that runs the long pass — it drives a system Chrome instead of
   a downloaded build, which is the only reason it is acceptable there. */
function loadPlaywright() {
  for (const m of ['playwright', 'playwright-core']) {
    try { return require(m); } catch (e) { /* fall through */ }
  }
  const cache = join(process.env.HOME, '.npm', '_npx');
  const hit = existsSync(cache) && require('fs').readdirSync(cache)
    .map((d) => join(cache, d, 'node_modules', 'playwright'))
    .find((p) => existsSync(p));
  if (!hit) throw new Error('playwright not found — set NODE_PATH or install it');
  return require(hit);
}
const { chromium } = loadPlaywright();

/* The engine this ran on is part of the measurement, so it is recorded rather
   than assumed: same page, different Chrome, different frame counts. */
function launchOpts() {
  const o = {};
  if (process.env.CHROME_PATH) o.executablePath = process.env.CHROME_PATH;
  else o.channel = process.env.CHANNEL || 'chrome';
  /* Chrome refuses to sandbox as root, and a container's /dev/shm is often
     smaller than a page load wants. */
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  if (root) o.args = ['--no-sandbox', '--disable-dev-shm-usage'];
  return o;
}
const ENGINE = process.env.CHROME_PATH ? `chrome@${process.env.CHROME_PATH}`
  : (process.env.CHANNEL || 'chrome');

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => a.startsWith('--url=')) || '--url=https://udirobert.github.io/seer-six')
  .slice(6).replace(/\/$/, '');
const wantShots = !argv.includes('--no-shots');
/* --only=dark|shots|matrix: run one pass and stop. The long pass costs ~15 min
   of Chromium, and a CSS fix should not have to pay for it to see one number. */
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').slice(7);

/* Bar order is the contract's own: 1 Seer, 2 App, 3 Deep, 4 Futarchy,
   5 Opportunity, 6 Risk, § Contract. /m/ is reached from a market row. */
const PAGES = [
  { key: 'home', path: '/', nth: 1, cues: [
    ['#fancards', 'the six as one fan-out, as a list'],
    ['#rootnode', 'the protocol root, named'],
    ['#departures', 'the disclosed departures from the kit']] },
  { key: 'app', path: '/app/', nth: 2, cues: [
    ['#rows', 'the explorer table'],
    ['#count', 'how many markets the snapshot holds'],
    ['#fineprint', 'the per-dataset snapshot stamp']] },
  { key: 'deep', path: '/deep/', nth: 3, cues: [
    ['#rail', 'the outcome rail'],
    ['#minted', 'collateral minted per leg'],
    ['#stage', 'the fan-out stage']] },
  { key: 'futarchy', path: '/futarchy/', nth: 4, cues: [
    ['#props', 'the zeroed fields the API actually returns'],
    ['#pair', 'a conditional pair, labelled composed'],
    ['#ev', 'the expected-value arithmetic']] },
  { key: 'opportunity', path: '/opportunity/', nth: 5, cues: [
    ['#sumline', 'the Σ = $1.00 invariant, as text'],
    ['#picks', 'the outcome legs'],
    ['#pay', 'payout at resolution']] },
  { key: 'risk', path: '/risk/', nth: 6, cues: [
    ['#ladder', 'the risk ladder'],
    ['#detail', 'the factor list'],
    ['#multiples', 'small multiples of the price series']] },
  { key: 'contract', path: '/contract/', nth: 7, cues: [
    ['#scale', 'the five steps drawn to scale'],
    ['#audit', 'the stylesheet and script audit'],
    ['#ledger', 'the measured frame ledger']] },
  /* A market that is a stem of the tree AND has a conditional child AND has a
     Swapr pool, so all three structural cues exist on one document. Reached in
     the walk by clicking that exact row, so cold and warm read the same object. */
  { key: 'm', path: '/m/?m=17340bafcb', market: '17340bafcb', cues: [
    ['.edge.up', 'the parent edge, or the statement that this is a root stem'],
    ['.fan', 'the conditional children, bordered and indented'],
    ['.chart', 'the price series, with its change printed as words']] },
];
/* The contract, restated here as data so the measurement can be checked
   against it rather than against prose. D step → milliseconds, exactly as
   /contract/ declares them in tokens.css. */
const STEP_MS = { 1: 200, 2: 220, 3: 320, 4: 400, 5: 520 };
const LEG_STEP = { verify: 1, lateral: 2, morph: 3, back: 3, redeem: 3,
  price: 4, fan: 5, split: 5 };

const VIEWPORTS = [['phone', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 900]];const MOTION = [['reduce', 'reduce'], ['full', 'no-preference']];
const WALK_WIDTH = 'desktop';

const log = (...a) => console.log(...a);

/* A CDN hiccup must not cost the whole evidence set: navigate through a retry,
   and if it still fails, record the failure and write what was measured. */
async function nav(p, url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      await p.goto(url, { waitUntil: 'load', timeout: 20000 });
      return;
    } catch (e) {
      if (i >= tries) throw e;
      log(`   retry ${i} ${url} — ${String(e.message).split('\n')[0]}`);
      await p.waitForTimeout(1200 * i);
    }
  }
}

/* A page that never answers must not take the whole evidence file with it.
   Without a timer, a stalled evaluate drains the event loop and Node exits on
   an unsettled top-level await — mid-run, fourteen minutes in, with nothing
   written. That is how the 14:11 pass died. */
function withTimeout(ms, what, promise) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`${what}: no answer in ${ms}ms`)), ms);
    }),
  ]);
}

/* ---------- in-page collectors ---------- */

const STATIC = (cues) => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const depth = document.getElementById('surface-depth');
  const bar = document.getElementById('surface-bar');
  const badge = document.getElementById('leg-badge');
  return {
    depth: depth ? { text: depth.textContent.replace(/\s+/g, ' ').trim(), visible: vis(depth) } : null,
    bar: {
      links: bar ? bar.querySelectorAll('a').length : 0,
      current: bar ? bar.querySelectorAll('a[aria-current]').length : 0,
      labelled: bar?.getAttribute('aria-label') || null
    },
    badge: badge ? { text: badge.textContent.replace(/\s+/g, ' ').trim(), visible: vis(badge) } : null,
    live: !!document.querySelector('[aria-live]'),
    lang: document.documentElement.lang || null,
    title: document.title,
    /* The claim under test is that ONE object crosses the boundary. A cold
       document has the same single bar and single h1; if the transition had
       left the outgoing view behind, these counts would double. */
    survival: {
      bars: document.querySelectorAll('#surface-bar').length,
      h1: document.querySelectorAll('h1').length,
      travellers: document.querySelectorAll('[data-vt]').length,
      named: [...document.querySelectorAll('[data-vt]')]
        .map((e) => e.getAttribute('data-vt')).sort().join(',')
    },
    positiveTabindex: [...document.querySelectorAll('[tabindex]')]
      .filter((e) => parseInt(e.getAttribute('tabindex'), 10) > 0).length,
    cues: cues.map(([sel, why]) => {
      const el = document.querySelector(sel);
      return { sel, why, present: !!el, visible: el ? vis(el) : false,
        text: el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) : null };
    }),
    audit: location.pathname.includes('/contract/')
      ? [...document.querySelectorAll('#audit .kv')].map((e) => ({
          what: e.children[0].textContent.trim(),
          value: e.children[1].textContent.trim(),
          tag: e.children[2].textContent.trim(),
          ok: e.dataset.ok === '1'
        }))
      : null
  };
};

const CONTRAST = () => {
  const num = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
  };
  const over = (fg, bk) => [0, 1, 2].map((i) => fg[i] * fg[3] + bk[i] * (1 - fg[3]));
  const flat = (c, a) => [0, 1, 2].map((i) => c[i] * a + page[i] * (1 - a));
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const sel = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}`
    : [...el.classList].slice(0, 2).map((c) => `.${c}`).join(''));
  function backstop(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { image: true };
      const c = num(cs.backgroundColor);
      if (c && c[3] > 0) layers.push(c);
      if (c && c[3] === 1) break;
      if (!n.parentElement) break;
    }
    let base = [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return { c: base };
  }
  const page = (() => {
    const c = num(getComputedStyle(document.documentElement).backgroundColor);
    return c && c[3] === 1 ? c.slice(0, 3) : [255, 255, 255];
  })();
  /* Group opacity fades the text and its own background toward the page at the
     same rate, so both must be composited before the ratio is taken. This is
     the check this harness was missing when axe found 3.82:1 white-on-violet in
     a row the stylesheet had dimmed with opacity: .78. */
  const groupAlpha = (el) => {
    let a = 1;
    for (let n = el; n; n = n.parentElement) a *= parseFloat(getComputedStyle(n).opacity);
    return a;
  };
  const found = [];
  let skippedOverImage = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
    if (el.closest('[aria-hidden="true"], template, script, style')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.right < 0 || r.left > innerWidth) continue;
    const fg = num(cs.color);
    if (!fg || fg[3] < 0.5) continue;
    const bk = backstop(el);
    if (bk.image) { skippedOverImage++; continue; }
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const value = ratio(flat(over(fg, bk.c), groupAlpha(el)), flat(bk.c, groupAlpha(el)));
    found.push({ sel: sel(el), text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 46),
      px: Math.round(size * 10) / 10, need, ratio: Math.round(value * 100) / 100,
      alpha: Math.round(groupAlpha(el) * 100) / 100,
      fg: cs.color, bg: `rgb(${bk.c.map(Math.round).join(', ')})` });
  }
  const ratios = found.map((f) => f.ratio).sort((a, b) => a - b);
  return {
    checked: found.length,
    min: ratios[0] ?? null,
    p10: ratios[Math.floor(ratios.length * 0.1)] ?? null,
    median: ratios[Math.floor(ratios.length / 2)] ?? null,
    fails: found.filter((f) => f.ratio < f.need).sort((a, b) => a.ratio - b.ratio).slice(0, 15),
    failCount: found.filter((f) => f.ratio < f.need).length,
    skippedOverImage
  };
};

const FOCUS_PREP = () => {
  let i = 0;
  for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
    el.dataset.fi = String(i++);
  }
  return i;
};
const FOCUS_READ = () => {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return null;
  const cs = getComputedStyle(a);
  return {
    fi: a.dataset.fi !== undefined ? Number(a.dataset.fi) : null,
    tag: a.tagName.toLowerCase(),
    inBar: !!a.closest('#surface-bar'),
    txt: (a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    /* "auto" is what a native focus ring reports in Chromium — the UA default,
       not the author's. Counting it as missing would fail every <input> on
       the site for the wrong reason. */
    ring: cs.outlineStyle === 'auto'
      || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
  };
};

/* ---------- the run ---------- */

async function collect(page, p, label) {
  await p.waitForFunction(() => window.__vt, null, { timeout: 8000 }).catch(() => {});
  const probe = await p.evaluate(() => window.__vt || null);
  const stat = await p.evaluate(STATIC, page.cues);
  stat.cues.forEach((c) => { c.page = page.key; });
  const contrast = await p.evaluate(CONTRAST);
  const rec = { page: page.key, url: `${BASE}${page.path}`, load: label,
    viewport: `${p.viewportSize().width}x${p.viewportSize().height}`,
    motion: p._motion, probe, ...stat, contrast };
  log(`   ${page.key.padEnd(11)} ${label.padEnd(4)} probe ${probe ? `${probe.longest}/${probe.frames}f` : 'none'}  ` +
    `cues ${stat.cues.filter((c) => c.visible).length}/${stat.cues.length}  contrast min ${contrast.min}` +
    ` fails ${contrast.failCount}`);
  return rec;
}

async function axeRun(p, page) {
  await p.addScriptTag({ path: AXE });
  const res = await p.evaluate(async () => await window.axe.run(document, {
    resultTypes: ['violations'],
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
  }));
  return { page: page.key, viewport: `${p.viewportSize().width}`, motion: p._motion,
    passes: res.passes.length,
    violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length,
      sample: v.nodes[0]?.html?.slice(0, 110) || null, target: v.nodes[0]?.target?.join(' ') })) };
}

async function focusWalk(p, page) {
  await nav(p, `${BASE}${page.path}`);
  /* The rail is built by shell.js at module evaluation. Numbering the tab stops
     before it exists measures a page that nobody ever reads. */
  await p.waitForFunction(() => document.querySelector('#surface-bar a'),
    null, { timeout: 6000 }).catch(() => log(`   ! no rail links on ${page.key}`));
  const total = await p.evaluate(FOCUS_PREP);
  const seq = [];
  for (let k = 0; k < Math.min(total + 4, 48); k++) {
    await p.keyboard.press('Tab');
    const r = await p.evaluate(FOCUS_READ);
    if (!r) break;
    if (seq.length && r.fi !== null && seq[seq.length - 1].fi !== null && r.fi <= seq[seq.length - 1].fi) break;
    seq.push(r);
  }
  const bars = seq.filter((s) => s.inBar);
  return { page: page.key, focusables: total, reached: seq.length,
    monotonic: seq.every((s, i) => s.fi === null || i === 0 || seq[i - 1].fi === null || s.fi > seq[i - 1].fi),
    barLinksReached: new Set(bars.map((b) => b.txt)).size,
    ringsMissing: seq.filter((s) => !s.ring).map((s) => `${s.tag} ${s.txt}`).slice(0, 6) };
}

async function shots(browser) {
  const widths = [[390, 844], [768, 1024], [1100, 900], [1440, 900]];
  const ctx = await browser.newContext({ reducedMotion: 'no-preference', deviceScaleFactor: 1 });
  const out = [];
  for (const page of PAGES) {
    for (const [w, h] of widths) {
      const p = await ctx.newPage();
      await p.setViewportSize({ width: w, height: h });
      await nav(p, `${BASE}${page.path}`);
      await p.waitForTimeout(1500);
      const file = join(SHOTS, `${page.key}-${w}.png`);
      await p.screenshot({ path: file, fullPage: w >= 1440 });
      out.push({ page: page.key, width: w, file: `evidence/shots/${page.key}-${w}.png` });
      log(`   shot ${page.key}-${w}`);
      await p.close();
    }
  }
  await ctx.close();
  return out;
}

/* The kit ships two themes and a reader may be in either. Contrast is a
   property of rendered pixels, so the dark surface is measured too rather than
   assumed to be the light one with the colours swapped. */
async function darkPass(browser) {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference',
    viewport: { width: 1440, height: 900 } });
  const out = [];
  for (const page of PAGES) {
    const p = await ctx.newPage();
    try {
      await nav(p, `${BASE}${page.path}`);
      /* Same readiness discipline as collect(): the dark numbers have to be
         comparable with the light ones, and a page sampled before its rows are
         in the DOM reports a smaller, easier world. */
      await p.waitForFunction(() => window.__vt, null, { timeout: 8000 }).catch(() => {});
      await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await p.waitForTimeout(250);
      const c = await withTimeout(45000, `contrast ${page.key}`, p.evaluate(CONTRAST));
      out.push({ page: page.key, theme: 'dark', ...c });
      log(`   dark ${page.key.padEnd(11)} min ${c.min}  fails ${c.failCount}` +
        (ONLY === 'dark' && c.fails.length ? `\n      ${c.fails.map((f) =>
          `${f.ratio}(${f.need}) ${f.sel} "${f.text.slice(0, 24)}" ${f.px}px a${f.alpha} ${f.fg} on ${f.bg}`).join('\n      ')}` : ''));
    } catch (e) { note(`dark ${page.key}`, e); }
    await p.close().catch(() => {});
  }
  await ctx.close().catch(() => {});
  return out;
}

function summarise(rows, axe, focus, dark) {
  const warm = rows.filter((r) => r.load === 'warm' && r.probe);
  const cold = rows.filter((r) => r.load === 'cold' && r.probe);
  const by = (m) => warm.filter((r) => r.motion === m);
  const namesOf = (rs) => [...new Set(rs.flatMap((r) => r.probe.anims || []))].sort();
  /* Math.min() of an empty list is Infinity, which is a worse way to report a
     skipped pass than saying so. */
  const lo = (a) => (a.length ? Math.round(Math.min(...a) * 100) / 100 : null);
  const cues = rows.flatMap((r) => r.cues);
  const contrast = rows.map((r) => r.contrast);
  return {
    arrivalsMeasured: warm.length,
    reduceSnaps: {
      claim: 'with motion reduced, no arrival animates for longer than one frame — every transition resolves to its end state instead of pausing halfway',
      arrivals: by('reduce').length,
      maxLongestRunFrames: Math.max(0, ...by('reduce').map((r) => r.probe.longest)),
      maxLongestRunMs: Math.max(0, ...by('reduce').map((r) => r.probe.ms)),
      anyMoving: by('reduce').some((r) => r.probe.moving > 0),
      /* A 0.01 ms animation can still be caught alive by one rAF sample. The
         honest number is therefore "≤1 frame", and the milliseconds are what
         separate a snap from a pause — not the frame count alone. */
      fullMotionComparator: { maxFrames: Math.max(0, ...by('full').map((r) => r.probe.longest)),
        maxMs: Math.max(0, ...by('full').map((r) => r.probe.ms)) }
    },
    motionRuns: {
      claim: 'with motion on, the same arrivals are visibly running for the leg’s whole interval',
      arrivals: by('full').length,
      minLongestRunFrames: by('full').length ? Math.min(...by('full').map((r) => r.probe.longest)) : null,
      maxLongestRunFrames: Math.max(0, ...by('full').map((r) => r.probe.longest)),
      legs: Object.fromEntries(by('full').map((r) => [r.page, `${r.probe.leg}:${r.probe.longest}f`]))
    },
    intervalHonesty: {
      /* The measured window is a lower bound: rAF sampling and a warm CDN both
         shave it, and the frame the transition finishes on is not observed. So
         the test is "did motion run for most of the declared interval", not
         "did the number match to the millisecond". */
      claim: 'the motion measured on arrival lands on the five-step scale the contract declares, per leg',
      rows: by('full').filter((r) => LEG_STEP[r.probe.leg]).map((r) => ({
        page: r.page, leg: r.probe.leg, step: LEG_STEP[r.probe.leg],
        declaredMs: STEP_MS[LEG_STEP[r.probe.leg]], measuredMs: r.probe.ms,
        ratio: Math.round((r.probe.ms / STEP_MS[LEG_STEP[r.probe.leg]]) * 100) / 100
      })),
      atOrAboveHalf: (() => {
        const z = by('full').filter((r) => LEG_STEP[r.probe.leg]);
        return `${z.filter((r) => r.probe.ms >= STEP_MS[LEG_STEP[r.probe.leg]] * 0.5).length}/${z.length}`;
      })()
    },
    objectSurvives: {
      claim: 'after a warm arrival exactly one chrome bar and one h1 exist, carrying the travelling names — the outgoing document did not persist beside the incoming one',
      arrivals: warm.length,
      minTravellers: warm.length ? Math.min(...warm.map((r) => r.survival.travellers)) : null,
      maxBars: Math.max(0, ...rows.map((r) => r.survival.bars)),
      maxH1: Math.max(0, ...rows.map((r) => r.survival.h1)),
      namedAcrossBoundary: [...new Set(rows.map((r) => r.survival.named))].slice(0, 8)
    },
    coldCuts: {
      /* Genuinely cold: each page is reached from about:blank, so no document
         opted in on the other side and the browser has nothing to transition
         from. Frames here are the in-page arrival choreography, which is a
         different thing from the boundary morph — the two separate by name. */
      claim: 'a cold arrival has no previous document, so the boundary morph never runs, yet the page renders complete',
      arrivals: cold.length,
      legs: [...new Set(cold.map((r) => r.probe.leg))],
      animationNames: namesOf(cold.filter((r) => r.motion === 'full')),
      warmOnlyAnimationNames: namesOf(by('full')).filter((n) => !namesOf(cold).includes(n)),
      maxLongestRunFrames: Math.max(0, ...cold.map((r) => r.probe.longest)),
      cuesVisibleAnyway: cold.filter((r) => r.cues.every((c) => c.visible)).length
    },
    structureSurvives: {
      claim: 'every static cue the motion stands for is on screen at three widths, both motion states',
      checked: cues.length, visible: cues.filter((c) => c.visible).length,
      missing: [...new Set(cues.filter((c) => !c.visible).map((c) => `${c.sel} on ${c.page || ''}`))]
    },
    depthLabels: {
      claim: 'each document states its surface number and depth from the protocol root in words',
      present: rows.filter((r) => r.depth && r.depth.visible).length, of: rows.length,
      samples: [...new Set(rows.filter((r) => r.depth).map((r) => r.depth.text))].slice(0, 10)
    },
    keyboard: {
      claim: 'the same transitions are reachable without a pointer, in DOM order, with a visible ring',
      walks: focus.length,
      monotonic: focus.filter((f) => f.monotonic).length,
      minBarLinksReached: lo(focus.map((f) => f.barLinksReached)),
      ringsMissing: [...new Set(focus.flatMap((f) => f.ringsMissing))].slice(0, 8),
      positiveTabindex: Math.max(0, ...rows.map((r) => r.positiveTabindex))
    },
    contrast: {
      claim: 'text contrast computed from rendered getComputedStyle values, in both themes, not eyeballed',
      /* Counts are readings, not unique elements: the same node is measured at
         three widths and in two motion states, which is the point of the matrix. */
      readings: contrast.reduce((s, c) => s + c.checked, 0),
      minRatio: lo(contrast.map((c) => c.min).filter((x) => x != null)),
      failReadings: contrast.reduce((s, c) => s + c.failCount, 0),
      failPages: [...new Set(rows.filter((r) => r.contrast.failCount).map((r) => `${r.page}/${r.viewport}`))],
      worst: rows.flatMap((r) => r.contrast.fails.map((f) => ({ ...f, page: r.page })))
        .sort((a, b) => a.ratio - b.ratio).slice(0, 10),
      dark: {
        readings: dark.reduce((s, c) => s + c.checked, 0),
        minRatio: lo(dark.map((c) => c.min).filter((x) => x != null)),
        failReadings: dark.reduce((s, c) => s + c.failCount, 0),
        failPages: dark.filter((c) => c.failCount).map((c) => c.page),
        worst: dark.flatMap((c) => c.fails.map((f) => ({ ...f, page: c.page })))
          .sort((a, b) => a.ratio - b.ratio).slice(0, 10)
      }
    },
    axe: {
      claim: 'axe-core WCAG 2.x at every page, both motion states',
      runs: axe.length,
      violations: axe.reduce((s, a) => s + a.violations.length, 0),
      byRule: Object.entries(axe.flatMap((a) => a.violations).reduce((m, v) => {
        m[v.id] = (m[v.id] || 0) + v.n; return m;
      }, {})).sort((a, b) => b[1] - a[1])
    },
    selfAudit: (() => {
      const c = rows.filter((r) => r.page === 'contract' && r.audit);
      if (!c.length) return null;
      const kv = Object.fromEntries(c[0].audit.map((r) => [r.what, r.value]));
      return { measuredInBrowser: true, rows: kv,
        allChecksPass: c.every((r) => r.audit.every((x) => x.ok)) };
    })()
  };
}

const started = new Date();
mkdirSync(OUT, { recursive: true });
if (wantShots) mkdirSync(SHOTS, { recursive: true });
log(`a11y evidence · ${BASE} · ${started.toISOString()}`);

const browser = await chromium.launch(launchOpts());
const version = await browser.version();
const OS = `${platform()} ${release()} ${arch()}`;
log(`engine: ${version} · ${OS}`);
const rows = []; const axe = []; const focusRows = []; const failures = [];
const note = (what, e) => {
  const msg = String(e && e.message || e).split('\n')[0];
  failures.push(`${what}: ${msg}`);
  log(`   ! ${what} — ${msg}`);
};

/* One pass, printed, nothing written: the loop a CSS fix needs. */
if (ONLY === 'dark') { await darkPass(browser); await browser.close(); process.exit(0); }
if (ONLY === 'shots') {
  const s = await shots(browser);
  log(`\n${s.length} screenshots → ${SHOTS}`);
  await browser.close(); process.exit(0);
}

for (const [mkey, mval] of MOTION) {
  for (const [vkey, w, h] of VIEWPORTS) {
    log(`\n· motion=${mkey} viewport=${vkey} (${w})`);
    const ctx = await browser.newContext({ reducedMotion: mval, viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    p._motion = mkey;

    for (const page of PAGES) {
      try {
        /* through about:blank so the previous document cannot opt in: this pass
           is the degradation case, arriving from somewhere that is not us. */
        await p.goto('about:blank');
        await nav(p, `${BASE}${page.path}`);
        rows.push(await collect(page, p, 'cold'));
        if (vkey === WALK_WIDTH) {
          const a = await axeRun(p, page);
          axe.push(a);
          if (a.violations.length) log(`   axe ${page.key}: ${a.violations.map((v) => `${v.id}×${v.n}`).join(' ')}`);
        }
      } catch (e) { note(`cold ${page.key}/${vkey}`, e); }
    }

    /* the walk: the rail is the product’s own path between documents, so the
       transition under test is the one a reader would get. */
    try {
      const first = PAGES.find((x) => x.key === 'app');
      await nav(p, `${BASE}${first.path}`);
      await p.waitForTimeout(1400);
      const order = ['deep', 'futarchy', 'opportunity', 'risk', 'contract', 'home', 'app', 'm'];
      for (const key of order) {
        const page = PAGES.find((x) => x.key === key);
        /* The rail is the product's own path between documents. /m/ has no rail
           entry, so it is reached the way a reader reaches it: by a market row. */
        const sel = key === 'contract' ? '#surface-bar .bar-rules'
          : page.market ? `[data-market="${page.market}"]`
            : `#surface-bar a:nth-of-type(${page.nth})`;
        const hit = await p.locator(sel).first().isVisible().catch(() => false);
        if (!hit && page.market) log(`   ! ${sel} absent — falling back to any row`);
        await p.click(hit || !page.market ? sel : '[data-market]');
        await p.waitForFunction(() => window.__vt, null, { timeout: 8000 }).catch(() => {});
        rows.push(await collect(page, p, 'warm'));
      }
    } catch (e) { note(`walk/${vkey}`, e); }
    await p.close();
    await ctx.close();

    if (mkey === 'reduce') {
      for (const fv of ['desktop', 'phone']) {
        const c2 = await browser.newContext({ reducedMotion: mval,
          viewport: { width: fv === 'desktop' ? 1440 : 390, height: fv === 'desktop' ? 900 : 844 } });
        const p2 = await c2.newPage();
        for (const page of PAGES) {
          try {
            const r = await focusWalk(p2, page);
            r.viewport = fv; r.motion = mkey;
            focusRows.push(r);
            if (!r.monotonic || r.ringsMissing.length) log(`   focus ${page.key}/${fv}: ${JSON.stringify(r)}`);
          } catch (e) { note(`focus ${page.key}/${fv}`, e); }
        }
        await p2.close(); await c2.close();
      }
    }
  }
}

const darkRows = await darkPass(browser).catch((e) => { note('dark pass', e); return []; });
const shotList = wantShots
  ? await shots(browser).catch((e) => { note('shots', e); return []; }) : [];
await browser.close().catch(() => {});

if (!rows.length) {
  log('\nnothing was measured — refusing to write an evidence file full of zeroes.');
  process.exit(2);
}

const doc = {
  generated: started.toISOString(),
  duration_s: Math.round((Date.now() - started.getTime()) / 1000),
  url: BASE,
  engine: `${ENGINE} ${version}`,
  os: OS,
  axe: readFileSync(AXE, 'utf8').match(/axe v[\d.]+/)[0],
  tool: `${BASE}/tools/a11y.mjs — the harness that produced this JSON, published beside it`,
  matrix: { pages: PAGES.length, viewports: VIEWPORTS.map((v) => v[1]),
    motion: MOTION.map((m) => m[0]), themes: ['light (3 viewports × 2 motion states)', 'dark (desktop)'] },
  summary: summarise(rows, axe, focusRows, darkRows),
  failures,
  rows, axe, focus: focusRows, dark: darkRows, shots: shotList
};
writeFileSync(join(OUT, 'a11y.json'), JSON.stringify(doc, null, 1));
log(`\nwrote evidence/a11y.json (${Math.round(JSON.stringify(doc).length / 1024)} KB) in ${doc.duration_s}s`);
if (failures.length) log(`incomplete in ${failures.length} place(s):\n  ${failures.join('\n  ')}`);
log(JSON.stringify(doc.summary, null, 1).slice(0, 3000));
