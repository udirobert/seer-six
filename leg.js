/* leg.js — classic, blocking, loaded before the stylesheet-free first paint.
   Four decisions must exist before the transition snapshots: which leg this
   document arrives by, the theme, whether motion is reduced, and whether the
   reader is forcing motion off to inspect the static hierarchy. It reads the
   incoming URL because a cross-document transition takes its timing from the
   incoming document — the origin can only hand over intent through the URL.

   It also carries the instrument. A transition between documents lives for a
   few hundred milliseconds and then is gone, and the only place it can be
   observed is the document being transitioned into. A probe that waits for the
   module graph to evaluate can start after the morph has finished, so this
   file — the first thing that runs — samples every frame from here. */
(function () {
  var h = document.documentElement, q = new URLSearchParams(location.search);
  var LEGS = { morph: 1, fan: 1, lateral: 1, back: 1, split: 1, redeem: 1, verify: 1 };
  h.dataset.leg = LEGS[q.get('leg')] ? q.get('leg') : 'direct';
  h.dataset.from = /^[a-z]{2,12}$/.test(q.get('from') || '') ? q.get('from') : '';
  var slow = parseFloat(q.get('slow') || '1');
  if (slow > 1 && slow <= 8) h.style.setProperty('--slow', String(slow));
  var s = {};
  try { s = JSON.parse(localStorage.getItem('seer.pref') || '{}'); } catch (e) { s = {}; }
  if (q.get('theme') === 'dark' || q.get('theme') === 'light') s.theme = q.get('theme');
  if (q.has('reduced')) s.reduced = q.get('reduced') === '1';
  if (s.theme === 'dark') h.dataset.theme = 'dark';
  if (s.reduced) h.dataset.reduced = '1';
  try { localStorage.setItem('seer.pref', JSON.stringify(s)); } catch (e) {}

  var reduced = h.dataset.reduced === '1' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ROOT = new URL('.', (document.currentScript || { src: location.href }).src).pathname
    .replace(/\/$/, '');
  var FRAMES = 70;
  var frame = 0, moving = 0, longest = 0, run = 0, t0 = 0, tBest = 0, tEnd = 0;
  var seen = new Set();
  (function sample() {
    /* An animation declared with fill-mode both stays in getAnimations() for
       the life of the document after it has finished, so “is the list empty”
       is not the question worth asking. The question is whether anything is
       running on this frame, and for how many milliseconds in a row. */
    var live = document.getAnimations().filter(function (a) { return a.playState === 'running'; });
    if (live.length) {
      var now = performance.now();
      if (!run) t0 = now;
      moving++; run++;
      if (run > longest) { longest = run; tBest = t0; tEnd = now; }
      live.forEach(function (a) { seen.add(a.animationName || 'waapi'); });
    } else run = 0;
    if (++frame < FRAMES) { requestAnimationFrame(sample); return; }
    var rec = {
      t: Math.round(Date.now() / 1000),
      path: location.pathname.slice(ROOT.length).replace(/index\.html$/, '') || '/',
      leg: h.dataset.leg,
      from: h.dataset.from || '—',
      slow: slow > 1 ? String(slow) : '1',
      reduced: reduced,
      frames: FRAMES,
      moving: moving,
      longest: longest,
      ms: longest ? Math.round(tEnd - tBest) : 0,
      anims: Array.from(seen).sort()
    };
    try {
      var log = JSON.parse(sessionStorage.getItem('seer.vt.log') || '[]');
      log.push(rec);
      sessionStorage.setItem('seer.vt.log', JSON.stringify(log.slice(-30)));
      sessionStorage.setItem('seer.vt', JSON.stringify(rec));
    } catch (e) {}
    window.__vt = rec;
  })();
})();
