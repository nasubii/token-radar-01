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
  `prices the board, not a guess. Implied value = <code>TVL × peer multiple × growth × maturity × reach × scale</code>, where ` +
  `growth follows the 7-day TVL change, maturity follows how long the protocol has run with no token, reach ` +
  `counts its chains, and scale corrects for size: within a category, the traded peers' multiples fall as TVL ` +
  `grows (fitted slope ${R.scale_beta} on log-log points), so a giant is not priced at a small peer's multiple. ` +
  `Each value also carries a range: the same arithmetic at the category's first and third quartile ` +
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
        <td class="num range-cell">${fmtUsd(r.implied_low_usd)} – ${fmtUsd(r.implied_high_usd)}</td>
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
    ${bar('Scale multiplier — size vs its category\u2019s peers', m.scale_multiplier, `${m.scale_multiplier.toFixed(2)}×`, 2.5)}
    <p class="formula">${fmtUsd(r.tvl_usd)} × <b>${m.multiple.toFixed(2)}</b> × ${m.growth_multiplier.toFixed(2)} × ${m.maturity_multiplier.toFixed(2)} × ${m.reach_multiplier.toFixed(2)} × ${m.scale_multiplier.toFixed(2)} = <b>${fmtUsd(r.implied_value_usd)}</b></p>
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
      <td class="num">${fmtUsd(c.ref_tvl)}</td>
    </tr>`,
  )
  .join('');

// ---- the calibration scatter -------------------------------------------------------------
// Every traded peer as a point: TVL (log) against the multiple the market pays for it (log).
// The downward drift is the scale effect the model fits within each category.
{
  const cv = $('scatter');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const pts = R.peers.filter((p) => p.tvl_usd > 0 && p.multiple > 0);
  const xs = pts.map((p) => Math.log10(p.tvl_usd));
  const ys = pts.map((p) => Math.log10(p.multiple));
  const x0 = Math.floor(Math.min(...xs));
  const x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.ceil(Math.max(...ys));
  const px = (x) => 46 + ((x - x0) / (x1 - x0)) * (W - 62);
  const py = (y) => H - 30 - ((y - y0) / (y1 - y0)) * (H - 46);
  ctx.strokeStyle = '#1e2c38';
  ctx.fillStyle = '#5b6d79';
  ctx.font = '11px ui-monospace, monospace';
  for (let gx = x0; gx <= x1; gx++) {
    ctx.beginPath(); ctx.moveTo(px(gx), 8); ctx.lineTo(px(gx), H - 30); ctx.stroke();
    const label = gx >= 9 ? `$${Math.pow(10, gx - 9)}B` : gx >= 6 ? `$${Math.pow(10, gx - 6)}M` : `$${Math.pow(10, gx - 3)}K`;
    ctx.fillText(label, px(gx) - 10, H - 14);
  }
  for (let gy = y0; gy <= y1; gy++) {
    ctx.beginPath(); ctx.moveTo(46, py(gy)); ctx.lineTo(W - 16, py(gy)); ctx.stroke();
    ctx.fillText(`${gy >= 0 ? Math.pow(10, gy).toFixed(0) : Math.pow(10, gy).toFixed(-gy)}×`, 4, py(gy) + 4);
  }
  const medY = py(Math.log10(R.global_multiple));
  ctx.strokeStyle = '#f5b544';
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(46, medY); ctx.lineTo(W - 16, medY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#2dd4bf';
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(px(Math.log10(p.tvl_usd)), py(Math.log10(p.multiple)), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  $('scatter-note').textContent =
    `Each point is one traded peer (${pts.length} in this snapshot): its TVL against the market-cap / TVL the market pays for it, both on log scales. ` +
    `The amber line is the global median multiple, ${R.global_multiple}×. Multiples drift down as TVL grows; fitted within categories, the slope is ${R.scale_beta}, ` +
    `which is the model's scale multiplier.`;
}

render();
