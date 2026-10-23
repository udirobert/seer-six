/* ============================================================
   live.js — the `?live=1` path
   The same endpoint dev/bake.py called, called from the reader's browser, so
   "this is Seer's data" is testable without opening a source file.

   Two rules, both of which outvote the temptation to be clever:
     · a failed fetch never empties a page. The bake stays on screen and the
       line says so, because a demo that dies on a 502 is a demo that lied
       about being live;
     · the page always states which of the two it is showing. A number that
       might be live and might be cached is neither.

   Only /app/ and /risk/ import this. The other six documents are the snapshot
   by design — a judge mid-morph must not have the object change under the
   cursor, and the morph is the claim.
   ============================================================ */

const API = 'https://app.seer.pm/.netlify/functions';

/* Mirrors bake.py exactly: the same 10-hex shortening, the same zero test (a
   field of all zeros is Seer for "absent"), the same rounding. If the two ever
   disagree, a live row and a baked row of the same market would not look alike
   in the same list, and the difference would be this file's bug. */
const isZero = (v) => !(v && String(v).replace(/^0x/, '').replace(/0/g, ''));
const short = (h) => (h ? String(h).slice(2, 12) : null);
const fnum = (v, nd) => { const n = parseFloat(v); return Number.isFinite(n) ? Number(n.toFixed(nd)) : null; };
const flat = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

export function rowFromApi(m) {
  const q = (m.questions || [{}])[0] || {};
  const outs = (m.outcomes || []).map((o) => flat(o).slice(0, 40));
  const parent = m.parentMarket || {};
  const row = {
    id: short(m.id),
    name: flat(m.marketName).slice(0, 96),
    ch: parseInt(m.chainId, 10) || 0,
    ty: m.type === 'Futarchy' ? 'F' : 'G',
    outs: outs.slice(0, 16),
    odds: (m.odds || []).slice(0, 16).map((o) => fnum(o, 2)),
    liq: Math.round(fnum(m.liquidityUSD, 0) || 0),
    vol: Math.round(fnum(m.volumeUSD, 0) || 0),
    cat: (m.categories || [null])[0] || null,
    v: (m.verification || {}).status || null,
    o: m.openingTs || null,
    f: m.finalizeTs || null,
    hl: !!m.hasLiquidity,
    arb: parseInt(m.questionsInArbitration, 10) || 0,
    rep: !!m.payoutReported,
    pm: isZero(parent.id) ? null : short(parent.id),
    po: m.parentOutcome == null ? null : m.parentOutcome,
    pc: isZero(m.parentCollectionId) ? null : short(m.parentCollectionId)
  };
  if (outs.length > 16) row.no = outs.length;
  if (q.is_pending_arbitration) row.pa = 1;
  if (['7', '8'].includes(String(m.templateId))) { row.lo = m.lowerBound; row.up = m.upperBound; }
  if (row.odds.length) row.odds = row.odds.map((x) => (x == null ? null : x)); else row.odds = null;
  return row;
}

async function post(fn, body, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${API}/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`${fn} answered ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`${fn} did not answer in ${ms / 1000} s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* The three calls dev/bake.py made, in one round trip. The second is not
   optional: minLiquidity alone answers with ~180 markets and none of the
   conditional children, and a live book with no tree in it would contradict
   every other surface on this host. */
export async function fetchLive({ limit = 400, minLiquidity = 1 } = {}) {
  const [counted, cond, top] = await Promise.all([
    post('markets-search', { limit: 1, page: 1 }),
    post('markets-search', { limit: 500, page: 1, showConditionalMarkets: true }),
    post('markets-search', { limit, page: 1, minLiquidity })
  ]);
  const seen = new Map();
  for (const m of [...(top.markets || []), ...(cond.markets || [])]) {
    let r;
    try { r = rowFromApi(m); } catch (e) { continue; }
    if (r.id && !seen.has(r.id)) seen.set(r.id, r);
  }
  const rows = [...seen.values()].sort((a, b) => b.liq - a.liq);
  if (!rows.length) throw new Error('markets-search answered with no markets');
  return { rows, universe: counted.count, at: new Date() };
}

const utc = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;

/* A live answer is merged onto the rows already on screen: values overwrite in
   place, markets the bake never saw are appended, and nothing is removed or
   reordered. Reshuffling the list under a reader who is mid-click would break
   the one thing this site claims — that a market keeps its identity across the
   boundary. Appended rows can still be read; the market document says so when
   an id is not in its bake. */
export function merge(rows, snapshot) {
  const want = new Map(rows.map((r) => [r.id, r]));
  let matched = 0;
  for (const old of snapshot) {
    const fresh = want.get(old.id);
    if (!fresh) continue;
    Object.assign(old, fresh);
    want.delete(fresh.id);
    matched++;
  }
  snapshot.push(...want.values());
  return matched;
}

/* One line, one `role="status"`, inserted before the host node. Written with
   textContent: the error strings come from a network response, and a page that
   interpolates those into markup is a page that lets the network type on it. */
export function liveState(hostEl) {
  let el = document.getElementById('live-state');
  if (!el) {
    el = document.createElement('p');
    el.id = 'live-state';
    el.className = 'live-state';
    el.setAttribute('role', 'status');
    hostEl.parentNode.insertBefore(el, hostEl);
  }
  return (k, text) => { el.dataset.k = k; el.textContent = text; };
}

export { utc };
