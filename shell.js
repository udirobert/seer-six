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

const MODULES = {
  markets: 'markets.js', tree: 'tree.js', cats: 'cats.js', charts: 'charts.js',
  events: 'events.js', people: 'people.js', links: 'links.js', meta: 'meta.js'
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
export function dur(step) {
  return token(`--d-${step}`, (v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000));
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

export function sameDoc(mutate) {
  if (!document.startViewTransition || reduced()) { mutate(); return null; }
  return document.startViewTransition(mutate);
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

export function marketURL(id, leg, from) {
  return `${ROOT}/m/?m=${encodeURIComponent(id)}&leg=${leg}&from=${encodeURIComponent(from || 'app')}`;
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

function toggles(nav, here) {
  const h = document.documentElement;
  nav.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-leg]');
    if (link) {
      e.preventDefault();
      const url = new URL(link.href);
      url.searchParams.set('leg', link.dataset.leg);
      url.searchParams.set('from', here.key);
      announce(`${link.textContent.trim()}, surface ${link.querySelector('.slot-n').textContent} of six.`);
      location.assign(url.href);
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
  const here = SURFACES.find((s) => s.key === opts.surface) || SURFACES[0];
  const nav = document.getElementById('surface-bar');
  if (nav) {
    nav.classList.add('vt-chrome');
    nav.setAttribute('aria-label', 'Seer surfaces');
    nav.innerHTML = SURFACES.map((s) => {
      const on = s.key === here.key;
      const leg = s.depth === here.depth ? 'lateral' : s.depth < here.depth ? 'back' : 'fan';
      return `<a href="${ROOT}/${s.href}" data-leg="${leg}"${on ? ' aria-current="page"' : ''}>` +
        `<span class="slot-n">${s.n}</span>${esc(s.label)}</a>`;
    }).join('') +
      `<span class="bar-tail">` +
      `<button type="button" data-act="theme" class="ghost">${here && document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark'}</button>` +
      `<button type="button" data-act="reduce" class="ghost" aria-pressed="${document.documentElement.dataset.reduced === '1'}">Reduce motion</button>` +
      `</span>`;
    toggles(nav, here);
  }

  const depth = document.getElementById('surface-depth');
  if (depth) {
    depth.innerHTML =
      `<b>${esc(here.label)} ${here.n}/6</b>` +
      `<span class="dsep">depth ${here.depth} from protocol root</span>` +
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

  document.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (!a.getAttribute('aria-label')) {
      a.setAttribute('aria-label', `${a.textContent.trim()} (opens Seer in a new tab)`);
    }
  });

  return { here };
}
