/* leg.js — classic, blocking, loaded before the stylesheet-free first paint.
   Four decisions must exist before the transition snapshots: which leg this
   document arrives by, the theme, whether motion is reduced, and whether the
   reader is forcing motion off to inspect the static hierarchy. It reads the
   incoming URL because a cross-document transition takes its timing from the
   incoming document — the origin can only hand over intent through the URL. */
(function () {
  var h = document.documentElement, q = new URLSearchParams(location.search);
  var LEGS = { morph: 1, fan: 1, lateral: 1, back: 1, split: 1, redeem: 1, verify: 1 };
  h.dataset.leg = LEGS[q.get('leg')] ? q.get('leg') : 'direct';
  h.dataset.from = /^[a-z]{2,10}$/.test(q.get('from') || '') ? q.get('from') : '';
  var s = {};
  try { s = JSON.parse(localStorage.getItem('seer.pref') || '{}'); } catch (e) { s = {}; }
  if (q.get('theme') === 'dark' || q.get('theme') === 'light') s.theme = q.get('theme');
  if (q.has('reduced')) s.reduced = q.get('reduced') === '1';
  if (s.theme === 'dark') h.dataset.theme = 'dark';
  if (s.reduced) h.dataset.reduced = '1';
  try { localStorage.setItem('seer.pref', JSON.stringify(s)); } catch (e) {}
})();
