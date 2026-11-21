// Launch Radar — the page. Reads window.RADAR (data.js, written by main.ts from the same
// board the gate checks), renders the ranked board with sorting and filters, a detail view
// per protocol with its model breakdown and farm plan, and the traded calibration set apart.
// No fetch, no imports, no network: everything on this page came out of the snapshot.
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const rowsEl = $('rows');
const state = { sort: 'rank', asc: true, q: '', category: '', chain: '', set: '', minTvl: 0 };

const fmtUsd = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
};
const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const fmtAge = (days) => {
  if (days === null || days === undefined) return '—';
  if (days < 365) return `${days}d`;
  return `${(days / 365).toFixed(1)}y`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- header stats and the model note -------------------------------------------------
$('stats').innerHTML = [
  ['Board rows', R.board_size],
  ['Watchlist', `${R.watchlist_size} / ${R.watchlist_size}`],
  ['Early finds', R.early_size],
  ['Traded peers', R.traded_count],
  ['Global multiple', `${R.global_multiple}×`],
  ['Snapshot', R.as_of],
]
  .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
  .join('');

$('model-note').innerHTML =
  `<strong>How a value is derived.</strong> Each category's multiple is the median market-cap / TVL of its ` +
  `traded peers in this snapshot (shrunk toward the global median of <code>${R.global_multiple}×</code>), so the market ` +
  `prices the board, not a guess. Implied value = <code>TVL × peer multiple × growth × maturity × reach</code>, where ` +
  `growth follows the 7-day TVL change, maturity follows how long the protocol has run with no token, and reach ` +
  `counts its chains. Each value also carries a range: the same arithmetic at the category's first and third quartile ` +
  `multiples, the middle half of what its peers actually get. Open any row for its own arithmetic and farm plan.`;

$('foot-note').textContent =
  `Source: ${R.source}. “Records no token” is what the snapshot's record says, not proof a token does not exist. ` +
  `An implied value is this board's own claim about a hypothetical launch, not a prediction that one will happen. Model ${R.model_version}.`;

// ---- filters --------------------------------------------------------------------------
const categories = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
$('f-category').innerHTML += categories.map((c) => `<option>${esc(c)}</option>`).join('');
const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
$('f-chain').innerHTML += chains.map((c) => `<option>${esc(c)}</option>`).join('');

const sortValue = (r, key) => {
  if (key === 'multiple') return r.model.multiple;
  if (key === 'category') return (r.category || '').toLowerCase();
  if (key === 'name') return r.name.toLowerCase();
  const v = r[key];
  return v === null || v === undefined ? -Infinity : v;
};

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  const list = R.rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.set === 'watchlist' && !r.watchlist) return false;
    if (state.set === 'early' && r.watchlist) return false;
    if (r.tvl_usd < state.minTvl) return false;
    return true;
  });
  list.sort((a, b) => {
    const va = sortValue(a, state.sort);
    const vb = sortValue(b, state.sort);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return state.asc ? cmp : -cmp;
  });
  return list;
}

function render() {
  const list = visibleRows();
  $('count').textContent = `Showing ${list.length} of ${R.rows.length} ranked protocols — every watchlist protocol is on the board.`;
  rowsEl.innerHTML = list
    .map(
      (r) => `<tr tabindex="0" data-slug="${esc(r.slug)}">
        <td class="num">${r.rank}</td>
        <td><span class="name">${esc(r.name)}</span>${r.watchlist ? '<span class="chip">Watchlist</span>' : '<span class="chip early">Early find</span>'}<span class="slug">${esc(r.slug)}</span></td>
        <td>${esc(r.category || '—')}</td>
        <td class="num">${fmtUsd(r.tvl_usd)}</td>
        <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${fmtPct(r.change_7d)}</td>
        <td class="num">${fmtAge(r.age_days)}</td>
        <td class="num">${r.model.multiple.toFixed(2)}×</td>
        <td class="num implied">${fmtUsd(r.implied_value_usd)}</td>
      </tr>`,
    )
    .join('');
  document.querySelectorAll('#board th').forEach((th) => {
    const on = th.dataset.sort === state.sort;
    th.classList.toggle('sorted', on);
    th.classList.toggle('asc', on && state.asc);
  });
}

$('q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('f-category').addEventListener('change', (e) => { state.category = e.target.value; render(); });
$('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; render(); });
$('f-set').addEventListener('change', (e) => { state.set = e.target.value; render(); });
$('f-tvl').addEventListener('change', (e) => { state.minTvl = Number(e.target.value); render(); });
document.querySelectorAll('#board th').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sort === key) state.asc = !state.asc;
    else { state.sort = key; state.asc = key === 'name' || key === 'category'; }
    render();
  });
});

// ---- fastest growers -------------------------------------------------------------------
$('movers').innerHTML = [...R.rows]
  .filter((r) => r.change_7d !== null)
  .sort((a, b) => b.change_7d - a.change_7d)
  .slice(0, 5)
  .map(
    (r) => `<button class="mover" data-slug="${esc(r.slug)}"><span class="mover-name">${esc(r.name)}</span><span class="up">${fmtPct(r.change_7d)}</span><span class="mover-sub">TVL ${fmtUsd(r.tvl_usd)} · implied ${fmtUsd(r.implied_value_usd)}</span></button>`,
  )
  .join('');
$('movers').addEventListener('click', (e) => {
  const b = e.target.closest('[data-slug]');
  if (b) openDetail(b.dataset.slug);
});

// ---- detail view ----------------------------------------------------------------------
const detail = $('detail');
const scrim = $('scrim');
let lastFocus = null;

function bar(label, value, shown, max, amber) {
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  return `<div class="bar-row"><div class="bar-label"><span>${esc(label)}</span><b>${esc(shown)}</b></div><div class="bar${amber ? ' amber' : ''}"><i style="width:${pct}%"></i></div></div>`;
}

function rangeGeom(r) {
  const max = r.implied_high_usd * 1.08;
  const left = (r.implied_low_usd / max) * 100;
  const width = Math.max(1.5, ((r.implied_high_usd - r.implied_low_usd) / max) * 100);
  const dot = Math.min(99, (r.implied_value_usd / max) * 100);
  return { left: left.toFixed(1), width: width.toFixed(1), dot: dot.toFixed(1) };
}

function openDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  lastFocus = document.activeElement;
  const m = r.model;
  detail.innerHTML = `
    <button class="close" id="d-close" aria-label="Close">×</button>
    <h2>${esc(r.name)}</h2>
    <p class="sub">${esc(r.slug)} · Rank #${r.rank} · ${r.watchlist ? 'On the snapshot watchlist' : 'Early find below the $50M floor'}</p>
    <dl class="kv">
      <dt>Implied launch value</dt><dd>${fmtUsd(r.implied_value_usd)}</dd>
      <dt>TVL</dt><dd>${fmtUsd(r.tvl_usd)}</dd>
      <dt>Category</dt><dd>${esc(r.category || '—')}</dd>
      <dt>Chains</dt><dd>${esc(r.chains.join(', ') || '—')}</dd>
      <dt>7-day TVL change</dt><dd>${fmtPct(r.change_7d)}</dd>
      <dt>Tracked since</dt><dd>${esc(r.listed_at || '—')} (${fmtAge(r.age_days)})</dd>
      <dt>Token status</dt><dd>Records no token</dd>
    </dl>
    <h3>Why this value</h3>
    ${bar(`Peer multiple — ${esc(r.category || 'all categories')}, ${m.comps} traded peer${m.comps === 1 ? '' : 's'}`, m.multiple, `${m.multiple.toFixed(2)}× TVL`, 1.5)}
    ${bar('Growth multiplier — 7-day TVL trend', m.growth_multiplier, `${m.growth_multiplier.toFixed(2)}×`, 1.6, true)}
    ${bar('Maturity multiplier — time running with no token', m.maturity_multiplier, `${m.maturity_multiplier.toFixed(2)}×`, 1)}
    ${bar('Reach multiplier — chains served', m.reach_multiplier, `${m.reach_multiplier.toFixed(2)}×`, 1.1, true)}
    <p class="formula">${fmtUsd(r.tvl_usd)} × <b>${m.multiple.toFixed(2)}</b> × ${m.growth_multiplier.toFixed(2)} × ${m.maturity_multiplier.toFixed(2)} × ${m.reach_multiplier.toFixed(2)} = <b>${fmtUsd(r.implied_value_usd)}</b></p>
    <h3>Implied range</h3>
    <p class="range-note">Priced at the middle half of its peers' multiples instead of the median: <b>${fmtUsd(r.implied_low_usd)}</b> to <b>${fmtUsd(r.implied_high_usd)}</b>. The marker is the headline value.</p>
    <div class="range" role="img" aria-label="Implied value range ${fmtUsd(r.implied_low_usd)} to ${fmtUsd(r.implied_high_usd)}, headline ${fmtUsd(r.implied_value_usd)}">
      <span class="range-band" style="left:${rangeGeom(r).left}%;width:${rangeGeom(r).width}%"></span>
      <span class="range-dot" style="left:${rangeGeom(r).dot}%"></span>
    </div>
    <div class="range-scale"><span>${fmtUsd(r.implied_low_usd)}</span><span>${fmtUsd(r.implied_high_usd)}</span></div>
    <h3>Farm plan</h3>
    <ol class="farm">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  detail.hidden = false;
  scrim.hidden = false;
  $('d-close').addEventListener('click', closeDetail);
  $('d-close').focus();
}
function closeDetail() {
  detail.hidden = true;
  scrim.hidden = true;
  if (lastFocus) lastFocus.focus();
}
rowsEl.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-slug]');
  if (tr) openDetail(tr.dataset.slug);
});
rowsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const tr = e.target.closest('tr[data-slug]');
  if (tr) openDetail(tr.dataset.slug);
});
scrim.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !detail.hidden) closeDetail(); });

// ---- the calibration set ---------------------------------------------------------------
$('live-rows').innerHTML = R.live
  .map(
    (p) => `<tr>
      <td><span class="name">${esc(p.name)}</span><span class="slug">${esc(p.slug)}</span></td>
      <td>${esc(p.symbol || '—')}</td>
      <td>${esc(p.category || '—')}</td>
      <td class="num">${fmtUsd(p.tvl_usd)}</td>
      <td class="num">${fmtUsd(p.mcap_usd)}</td>
      <td class="num">${p.multiple === null ? '—' : `${p.multiple.toFixed(2)}×`}</td>
    </tr>`,
  )
  .join('');

// ---- the calibration table --------------------------------------------------------------
$('calib-rows').innerHTML = R.calibration
  .slice(0, 14)
  .map(
    (c) => `<tr>
      <td><span class="name">${esc(c.category)}</span></td>
      <td class="num">${c.comps}</td>
      <td class="num">${c.multiple.toFixed(2)}×</td>
      <td class="num">${c.low.toFixed(2)}× – ${c.high.toFixed(2)}×</td>
    </tr>`,
  )
  .join('');

render();
