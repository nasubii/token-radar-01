// Token launch radar: the valuation model.
//
// The board ranks protocols that record no token yet by what a launch would be worth if the
// protocol's record stayed as it is. The value is not a flat guess: it is calibrated on the
// snapshot itself. Every protocol in the snapshot whose token already trades reports both a
// market cap and a TVL, so the market's own price of a dollar of TVL is observable, category
// by category. A pre-token protocol is priced at the multiple its traded peers actually get:
//
//   multiple(category) = median mcap/TVL of the category's traded protocols, shrunk toward
//                        the global median by sample size, clamped to [0.02, 3]
//   base               = tvl_usd x multiple(category)
//   growth             = 1 + clamp(change_7d, -50, 150) / 100 x 0.35   (no report: 1)
//   maturity           = 0.75 + 0.25 x (1 - exp(-age_days / 540))      (no date: 0.85)
//   reach              = 1 + 0.02 x min(chains - 1, 4)
//   implied_value_usd  = round(base x growth x maturity x reach)
//
// No protocol name is ever special-cased: calibrate() reads only the snapshot's figures, and
// score() applies the same arithmetic to every row. Protocols whose token already trades are
// never ranked: they are the calibration set, and the dashboard shows them apart, at the
// market's own values.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'comparables-2';
export const EARLY_ROWS = 200;
export const LIVE_ROWS = 30;

const MULT_FLOOR = 0.02;
const MULT_CAP = 3;
const SHRINKAGE = 6;
const GROWTH_WEIGHT = 0.35;
const GROWTH_FLOOR = -50;
const GROWTH_CAP = 150;

export interface Calibration {
  global_multiple: number;
  by_category: Map<string, { multiple: number; comps: number }>;
  traded_count: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The market's price of a TVL dollar, learned from the snapshot's traded protocols. */
export function calibrate(snapshot: Snapshot): Calibration {
  const all: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    if (p.category !== null) {
      const list = perCategory.get(p.category) ?? [];
      list.push(ratio);
      perCategory.set(p.category, list);
    }
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, { multiple: number; comps: number }>();
  for (const [category, ratios] of perCategory) {
    const shrunk = (ratios.length * median(ratios) + SHRINKAGE * global) / (ratios.length + SHRINKAGE);
    byCategory.set(category, { multiple: Math.min(MULT_CAP, Math.max(MULT_FLOOR, shrunk)), comps: ratios.length });
  }
  return { global_multiple: global, by_category: byCategory, traded_count: all.length };
}

const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface Score {
  implied: number;
  multiple: number;
  comps: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  age_days: number | null;
}

/** One protocol's implied launch value under the calibrated model. */
export function score(p: SnapshotProtocol, asOf: string, cal: Calibration): Score {
  const cat = p.category !== null ? cal.by_category.get(p.category) : undefined;
  const multiple = cat?.multiple ?? cal.global_multiple;
  const comps = cat?.comps ?? 0;
  const growthPct = p.change_7d === null ? 0 : Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, p.change_7d));
  const growth = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const age = ageDays(asOf, p.listed_at);
  const maturity = age === null ? 0.85 : 0.75 + 0.25 * (1 - Math.exp(-age / 540));
  const reach = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 4);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity * reach));
  return { implied, multiple, comps, growth_multiplier: growth, maturity_multiplier: maturity, reach_multiplier: reach, age_days: age };
}

/** Whether the snapshot records no token for a protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const DERIVATIVE_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a below-floor protocol may be ranked as an early find: pre-token, and not a wrapped,
 * staked, bridged or versioned product of something that already trades (the house's own
 * watchlist rule, applied below the floor as well).
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    (p.category === null || !DERIVATIVE_CATEGORY.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !DERIVATIVE_WORD.test(p.name) &&
    !EXCHANGE_LEAD.test(p.name)
  );
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    comps: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  traded_count: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The ranked board: every watchlist slug, plus the strongest early finds below the floor. */
export function buildBoard(snapshot: Snapshot, cal: Calibration): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, s: score(p, snapshot.as_of, cal) }))
    .sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, s: score(p, snapshot.as_of, cal) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const watch = new Set(snapshot.watchlist);
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    token_status: 'pre-token',
    watchlist: watch.has(p.slug),
    age_days: s.age_days,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      comps: s.comps,
      growth_multiplier: round4(s.growth_multiplier),
      maturity_multiplier: round4(s.maturity_multiplier),
      reach_multiplier: round4(s.reach_multiplier),
    },
    farm_steps: farmSteps(p, s.age_days),
  }));
}

/** Gas for one transaction on a chain, in dollars: mainnet is dear, rollups and Solana are not. */
function gasUsd(chain: string): string {
  if (chain === 'Ethereum') return '$4-10';
  if (chain === 'Solana') return 'under $0.10';
  if (['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Zora'].includes(chain)) return '$0.10-0.50';
  if (['BSC', 'Polygon', 'Avalanche', 'Fantom', 'Gnosis'].includes(chain)) return '$0.05-0.30';
  return 'about $1';
}

function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 10_000_000) return 50;
  return 25;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

/** The core farming action for a category, in words a reader can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow about 40% against it and re-supply the borrow once, so both sides of the market record your wallet`;
  if (c.includes('dex') || c.includes('exchange'))
    return `Trade about $${capital} through ${n}'s main pairs on ${chain} across several sessions, then park $${Math.round(capital / 2)} in its deepest stablecoin pool`;
  if (c.includes('perps') || c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC margin on ${n} and run one small hedged position (long and short the same asset) so volume and open interest both count`;
  if (c.includes('bridge') || c.includes('cross'))
    return `Bridge $${capital} of USDC to ${chain} through ${n} in three separate transfers on different days, and use the bridged funds in one app on the far side each time`;
  if (c.includes('restak') || c.includes('staking'))
    return `Stake $${capital} of ETH or its liquid staking token through ${n} on ${chain} and keep the receipt token in the same wallet, unstaked, for the whole window`;
  if (c.includes('rwa') || c.includes('real world'))
    return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} after its KYC or allowlist step if it has one, and hold the asset rather than trading it`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset ${n} issues on ${chain}, then supply half of it to a lending market so it works in two places`;
  if (c.includes('yield') || c.includes('aggregator') || c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${n} vault on ${chain}, choosing the vault with the most depositors rather than the highest advertised yield`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy to expiry`;
  if (c.includes('payment'))
    return `Route about $${capital} of real payments or transfers through ${n} over the month, in at least six separate transactions`;
  if (c.includes('chain') || c.includes('layer'))
    return `Bridge $${capital} to ${n}, then use two native apps (one swap, one lending market) so the wallet shows organic activity on the chain itself`;
  if (c.includes('basis') || c.includes('delta'))
    return `Open the $${capital} basis position ${n} is built for (spot long, perp short, or the vault share that holds it) and keep it delta-neutral for the window`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main product page and keep the position open for the whole window`;
}

/**
 * A protocol's farm plan: five concrete steps, each with its cost and its time. The plan is
 * generated from the protocol's own record (category, first chain, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasUsd(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const steps = [
    `Start with a fresh wallet funded only from an exchange withdrawal, holding the $${capital} you plan to farm plus gas money. Cost: ${gas} for the funding transaction on ${chain}. Time: 10 minutes.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of capital plus ${gas} per transaction in gas. Time: 20 minutes to set up.`,
    `Repeat one small qualifying action every week (a deposit, a swap, a vote or a claim) so the wallet reads as a regular user, not a one-day visitor. Cost: ${gas} in gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days and across two monthly snapshots; do not withdraw everything the same week a points or season page appears. Cost: the $${capital} stays deployed and exposed to the protocol's smart-contract risk. Time: ${hold} days.`,
    `Each Friday, open the protocol's own points, rewards or governance page from its official site and record your balance in a farm log; claim only from links the protocol itself publishes, never from a search ad or a direct message. Cost: nothing to check, and never pay a fee to claim. Time: 5 minutes a week.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The traded set: the calibration peers, shown apart at the market's own values. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const board = buildBoard(snapshot, cal);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: round4(cal.global_multiple),
    traded_count: cal.traded_count,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board checks. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
