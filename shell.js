/* shell.js — one runtime for six documents.
   It does three things nothing else in this entry can do alone: it hands a
   market object across the document boundary, it keeps the surface chrome
   continuous while the content changes, and it reads its own durations and
   easings out of the stylesheet, so no millisecond is ever decided twice. */

const SELF = new URL('.', import.meta.url).href;
export const ROOT = SELF.replace(/\/$/, '');

export const SURFACES = [
  { key: 'home',        n: 1, depth: 0, label: 'Seer',        href: 'index.html' },
  { key: 'app',         n: 2, depth: 1, label: 'App',         href: 'app/index.html' },
  { key: 'deep',        n: 3, depth: 1, label: 'Deep',        href: 'deep/index.html' },
  { key: 'futarchy',    n: 4, depth: 1, label: 'Futarchy',    href: 'futarchy/index.html' },
  { key: 'opportunity', n: 5, depth: 1, label: 'Opportunity', href: 'opportunity/index.html' },
  { key: 'risk',        n: 6, depth: 1, label: 'Risk',        href: 'risk/index.html' }
];

/* The seventh document is not a surface: it is the rules the six obey. It sits
   at the root beside the protocol node, so it is reachable from every page
   without inflating "six interfaces" into seven. */
export const RULES = { key: 'contract', n: null, depth: 0, label: 'Contract', href: 'contract/index.html' };

const MODULES = {
  markets: 'markets.js', tree: 'tree.js', cats: 'cats.js', charts: 'charts.js',
  events: 'events.js', people: 'people.js', links: 'links.js', meta: 'meta.js',
  futarchy: 'futarchy.js'
};

export async function load(...keys) {
  const out = {};
  await Promise.all(keys.map(async (k) => {
    const mod = await import(`${SELF}data/${MODULES[k]}`);
    out[k] = mod[Object.keys(mod)[0]];
  }));
  return out;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- the contract's clock ---------- */

const numCache = new Map();
function token(name, parse) {
  if (!numCache.has(name)) {
    numCache.set(name, parse(getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim()));
  }
  return numCache.get(name);
}
/* A duration is only a number once the browser has resolved it: --d-* are
   calc() expressions now that ?slow scales the whole scale, so read the used
   value off a probe rather than parsing the token's text. */
const probe = document.createElement('span');
probe.style.display = 'none';
export function dur(step) {
  const name = `--d-${step}`;
  if (!numCache.has(name)) {
    document.documentElement.appendChild(probe);
    probe.style.animationDuration = `var(${name})`;
    numCache.set(name, Math.round(parseFloat(getComputedStyle(probe).animationDuration) * 1000));
    probe.remove();
  }
  return numCache.get(name);
}
export function ease(which = 'out') {
  return token(`--e-${which}`, (v) => v || 'ease-out');
}

export function reduced() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.reduced === '1';
}

/* Snap, don't pause: with motion off the element is simply left in the state
   the animation was going to arrive at, and the static structure already on
   screen carries the meaning. */
export function animate(el, frames, opts = {}) {
  if (!el?.animate || reduced()) return null;
  return el.animate(frames, {
    duration: dur(opts.step || 3),
    easing: ease(opts.easing || 'out'),
    fill: 'both'
  });
}

/* An in-page leg is the same contract as a cross-document one: the caller says
   which relation it is walking, the stylesheet decides how long that takes. */
export function sameDoc(mutate, leg) {
  if (!document.startViewTransition || reduced()) { mutate(); return null; }
  const h = document.documentElement;
  const prev = h.dataset.leg;
  if (leg) h.dataset.leg = leg;
  const t = document.startViewTransition(mutate);
  if (leg) t.finished.finally(() => { h.dataset.leg = prev; });
  return t;
}

/* ---------- the leg badge ---------- */

export const LEG_STEP = { morph: 3, fan: 5, lateral: 2, back: 3, split: 5, redeem: 3, verify: 1 };

/* The badge is the argument written on the screen: it names the relation the
   current motion stands for and the token that times it, so no reader has to
   trust that a duration came from anywhere other than the contract. */
export function legBadge(opts = {}) {
  const badge = document.getElementById('leg-badge');
  if (!badge) return;
  const h = document.documentElement;
  const draw = () => {
    const leg = h.dataset.leg;
    const step = LEG_STEP[leg];
    badge.innerHTML = `<b>leg · ${esc(step ? leg : 'cold arrival')}</b>` +
      (step ? `<span>${dur(step)}ms · --d-${step}</span>` +
        `<span class="faded">${esc(ease(leg === 'lateral' ? 'std' : 'out'))}</span>` : '') +
      `<span class="faded">reduced: ${reduced() ? 'on (snap)' : 'off'}</span>` +
      (opts.tail ? `<span class="faded">${esc(opts.tail)}</span>`
        : `<span class="faded">from: ${esc(h.dataset.from || 'direct')}</span>`);
  };
  draw();
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', draw);
  new MutationObserver(draw).observe(h,
    { attributes: true, attributeFilter: ['data-reduced', 'data-leg', 'data-theme'] });
}

/* ---------- formatters ---------- */

const HOUR = 3600, DAY = 86400;
export function money(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
  return '$' + n.toFixed(0);
}
export function pct(v, dp = 1) {
  return v == null || isNaN(v) ? '—' : v.toFixed(dp) + '%';
}
export function ago(ts, now = Date.now() / 1000) {
  if (!ts) return 'no date set';
  const d = ts - now, past = d < 0, a = Math.abs(d);
  const [n, unit] = a >= 30 * DAY ? [Math.round(a / 30 / DAY), 'mo']
    : a >= DAY ? [Math.round(a / DAY), 'd']
    : a >= HOUR ? [Math.round(a / HOUR), 'h']
    : [Math.max(1, Math.round(a / 60)), 'min'];
  return past ? `${n}${unit} ago` : `in ${n}${unit}`;
}
export function stateOf(r, now = Date.now() / 1000) {
  if (r.rep) return { k: 'resolved', t: 'Resolved' };
  if (r.arb || r.pa) return { k: 'arb', t: 'In arbitration' };
  if (r.f && r.f < now) return { k: 'finalizing', t: 'Finalizing' };
  if (!r.hl) return { k: 'noliquidity', t: 'No pool' };
  return { k: 'live', t: 'Open' };
}

/* ---------- the history line ---------- */

/* One implementation of an honesty rule, shared by every surface: a line is
   drawn only where the API actually has a pool series, the level is indexed to
   its own first print because the quote asset is savings xDAI rather than
   dollars, and a row with no pool says so in words. */
export function spine(charts, id, w = 120, h = 26) {
  const s = charts?.[id];
  const pts = s?.[0]?.s || [];
  if (!s) return '<span class="nohist">no pool history</span>';
  if (pts.length < 2) return '<span class="nohist">too few prints</span>';
  const pad = 2;
  const vals = pts.map((p) => p[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals), rg = hi - lo || 1;
  const X = (i) => (i / (pts.length - 1)) * (w - pad * 2) + pad;
  const Y = (v) => h - pad - ((v - lo) / rg) * (h - pad * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1][1], first = pts[0][1];
  const dir = last > first ? 'up' : last < first ? 'down' : 'flat';
  const chg = first > 0 ? ((last - first) / first) * 100 : 0;
  return `<svg class="spine" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path class="area" d="${d} L${X(pts.length - 1)} ${h} L${X(0)} ${h} Z" data-hist="${dir}"/>
    <path class="line" d="${d}"/><circle cx="${X(pts.length - 1)}" cy="${Y(last)}" r="2"/>
  </svg><span class="delta" data-dir="${dir}">${dir === 'flat' ? '±' : dir === 'up' ? '▲' : '▼'}${pct(Math.abs(chg), 1)}<em>idx</em></span>`;
}

/* ---------- the travelling object ---------- */

/* Names are assigned at the moment of the click, never in the markup: two
   elements in one document may not share a view-transition-name, and a list
   of 284 rows would otherwise collide with itself. Three parts travel — the
   question, the outcome prices, the history — and a container is deliberately
   not named, because a named parent would snapshot its named children twice. */
const TRAVEL = [['[data-vt="name"]', 'vt-mkt-name'],
                ['[data-vt="odds"]', 'vt-mkt-odds'],
                ['[data-vt="spine"]', 'vt-mkt-spine']];

export function disarm() {
  document.querySelectorAll('.vt-mkt-name,.vt-mkt-odds,.vt-mkt-spine')
    .forEach((n) => n.classList.remove('vt-mkt-name', 'vt-mkt-odds', 'vt-mkt-spine'));
}

export function tagTravellers(root) {
  if (!root) return;
  disarm();
  for (const [sel, cls] of TRAVEL) {
    const el = root.querySelector(sel);
    if (el) el.classList.add(cls);
  }
}

/* pointerdown, not click: the snapshot is taken as navigation begins, so the
   names have to exist before the browser decides what to capture. */
export function armTravellers(container) {
  container.addEventListener('pointerdown', (e) => {
    const row = e.target.closest?.('[data-market]');
    if (row) tagTravellers(row);
  }, { passive: true });
}

/* ?slow has to ride every leg or a film pass loses its mid-morph the moment
   the page navigates. Theme and reduced state already travel in localStorage. */
function keepFilm(url) {
  const s = new URLSearchParams(location.search).get('slow');
  if (s && !url.searchParams.has('slow')) url.searchParams.set('slow', s);
  return url;
}

export function marketURL(id, leg, from) {
  return keepFilm(new URL(`${ROOT}/m/?m=${encodeURIComponent(id)}&leg=${leg}&from=${encodeURIComponent(from || 'app')}`)).href;
}
export function seerURL(market, links) {
  const slug = links?.[market.id];
  return slug ? `https://app.seer.pm/markets/${market.ch}/${slug}` : null;
}

/* ---------- data index ---------- */

export function index(markets, tree) {
  const byId = new Map(markets.map((m) => [m.id, m]));
  const kids = new Map();
  markets.forEach((m) => { if (m.pm) (kids.get(m.pm) || kids.set(m.pm, []).get(m.pm)).push(m.id); });
  const treeByParent = new Map((tree || []).map((t) => [t.pm, t]));
  const depth = (m, seen = 0) =>
    !m?.pm || seen > 7 ? seen : depth(byId.get(m.pm), seen + 1);
  return { byId, kids, treeByParent, depthOf: (id) => depth(byId.get(id)),
           parentOf: (id) => byId.get(byId.get(id)?.pm || '') || null };
}

/* ---------- chrome ---------- */

function savePref(patch) {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('seer.pref') || '{}'); } catch (e) { s = {}; }
  try { localStorage.setItem('seer.pref', JSON.stringify(Object.assign(s, patch))); } catch (e) {}
}

export function announce(msg) {
  let el = document.getElementById('route-announcer');
  if (!el) {
    el = document.createElement('p');
    el.id = 'route-announcer';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.className = 'visually-hidden';
    document.body.appendChild(el);
  }
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 60);
}

function rulesHref(here) {
  const u = keepFilm(new URL(`${ROOT}/${RULES.href}`, location.href));
  u.searchParams.set('leg', here.depth === 0 ? 'fan' : 'lateral');
  u.searchParams.set('from', here.key);
  return `${u.pathname}${u.search}`;
}

function toggles(nav, here) {
  const h = document.documentElement;
  nav.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-leg]');
    if (link) {
      /* The leg is already in the href, so the browser performs the
         navigation: intercepting it to call location.assign would take the
         transition off the link-click path it was designed for. */
      announce(link.classList.contains('bar-rules')
        ? 'Contract. The rules these six documents obey.'
        : `${link.textContent.trim()}, surface ${link.querySelector('.slot-n').textContent} of six.`);
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'theme') {
      const dark = h.dataset.theme !== 'dark';
      h.dataset.theme = dark ? 'dark' : 'light';
      btn.textContent = dark ? 'Light' : 'Dark';
      savePref({ theme: h.dataset.theme });
    } else {
      setReduced(h.dataset.reduced !== '1');
      btn.setAttribute('aria-pressed', String(h.dataset.reduced === '1'));
    }
  });
}

export function setReduced(on) {
  const h = document.documentElement;
  if (on) h.dataset.reduced = '1'; else delete h.dataset.reduced;
  savePref({ reduced: on });
  const btn = document.querySelector('[data-act="reduce"]');
  if (btn) btn.setAttribute('aria-pressed', String(on));
  announce(on
    ? 'Motion reduced. The transition no longer carries the meaning; the static structure does.'
    : 'Motion restored.');
}

export function boot(opts) {
  const here = SURFACES.find((s) => s.key === opts.surface) || RULES;
  const rules = here.key === RULES.key;
  const nav = document.getElementById('surface-bar');
  if (nav) {
    nav.classList.add('vt-chrome');
    nav.setAttribute('aria-label', 'Seer surfaces');
    nav.innerHTML = SURFACES.map((s) => {
      const on = s.key === here.key;
      const leg = rules ? (s.key === 'home' ? 'back' : 'fan')
        : s.depth === here.depth ? 'lateral' : s.depth < here.depth ? 'back' : 'fan';
      const href = keepFilm(new URL(`${ROOT}/${s.href}`, location.href));
      href.searchParams.set('leg', leg);
      href.searchParams.set('from', here.key);
      return `<a href="${href.pathname}${href.search}" data-leg="${leg}"${on ? ' aria-current="page"' : ''}>` +
        `<span class="slot-n">${s.n}</span>${esc(s.label)}</a>`;
    }).join('') +
      `<a href="${rulesHref(here)}" data-leg="${here.depth === 0 ? 'fan' : 'lateral'}"${rules ? ' aria-current="page"' : ''} class="bar-rules"><span class="slot-n">§</span>Contract</a>` +
      `<span class="bar-tail">` +
      `<button type="button" data-act="theme" class="ghost">${document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark'}</button>` +
      `<button type="button" data-act="reduce" class="ghost" aria-pressed="${document.documentElement.dataset.reduced === '1'}">Reduce motion</button>` +
      `</span>`;
    toggles(nav, here);
  }

  const depth = document.getElementById('surface-depth');
  if (depth) {
    depth.innerHTML =
      `<b>${esc(here.label)}${here.n != null ? ` ${here.n}/6` : ''}</b>` +
      `<span class="dsep">${here.n != null
        ? `depth ${here.depth} from protocol root`
        : 'the rules the six obey · not a surface'}</span>` +
      (opts.marketDepth != null
        ? `<span class="dsep">market tree depth ${opts.marketDepth}</span>` : '');
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey ||
        /^(input|textarea|select)$/i.test(e.target.tagName)) return;
    if (e.key === 'r' || e.key === 'R') setReduced(document.documentElement.dataset.reduced !== '1');
    if (e.key === 'd' || e.key === 'D') {
      const h = document.documentElement;
      h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark';
      savePref({ theme: h.dataset.theme });
      const b = document.querySelector('[data-act="theme"]');
      if (b) b.textContent = h.dataset.theme === 'dark' ? 'Light' : 'Dark';
    }
  });

  /* Only links that leave the site get a new tab. A same-origin link stamped
     with target="_blank" opens a second browsing context, and a
     cross-document view transition cannot happen across one — the morph dies
     silently and the whole claim with it. */
  document.querySelectorAll('a[href^="http"]').forEach((a) => {
    if (a.host === location.host) return;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (!a.getAttribute('aria-label')) {
      a.setAttribute('aria-label', `${a.textContent.trim()} (opens Seer in a new tab)`);
    }
  });

  vtProbe();
  return { here };
}

/* A cross-document transition lives for a few frames and then disappears, so
   nothing can assert on it after the fact. Sample what is animating across the
   first second of every arrival and leave the record where a harness can read
   it. The frame count is the reduced-motion proof in numbers: with motion on an
   arrival spends a visible run of frames animating, with motion off it reaches
   its end state in one, because the contract snaps rather than pausing. */
function vtProbe() {
  const h = document.documentElement;
  const seen = new Set();
  const FRAMES = 70;
  let frame = 0, moving = 0, longest = 0, run = 0;
  (function sample() {
    const list = document.getAnimations();
    if (list.length) {
      moving++; run++; longest = Math.max(longest, run);
      for (const a of list) seen.add(a.animationName || 'waapi');
    } else run = 0;
    if (++frame < FRAMES) { requestAnimationFrame(sample); return; }
    const rec = {
      t: Math.round(Date.now() / 1000),
      path: location.pathname.replace(ROOT, '') || '/',
      leg: h.dataset.leg,
      from: h.dataset.from || '—',
      slow: getComputedStyle(h).getPropertyValue('--slow').trim() || '1',
      reduced: reduced(),
      frames: FRAMES,
      moving,
      longest,
      anims: [...seen].sort()
    };
    try {
      const log = JSON.parse(sessionStorage.getItem('seer.vt.log') || '[]');
      log.push(rec);
      sessionStorage.setItem('seer.vt.log', JSON.stringify(log.slice(-30)));
      sessionStorage.setItem('seer.vt', JSON.stringify(rec));
    } catch (e) {}
    window.__vt = rec;
  })();
}
