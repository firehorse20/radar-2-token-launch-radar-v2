// Token Radar model, radar-3: one sealed snapshot in, one ranked board out.
//
// The whole model is six factors, each a small function below, so the
// dashboard can restate it and a reader can check any row by hand:
//
//   implied = base x growth x maturity x chain x category x standing
//
//   base     = tvl_usd x 0.25
//   growth   = 1 + clamp(change_7d, -60, 120) / 100 x 1.00
//   maturity = 0.60 at birth, rising to 1.00 at 540 days, easing to 0.80
//              after three years (age unknown: 365)
//   chain    = 1 + 0.025 x min(chains - 1, 8)              (1.00 - 1.20)
//   category = the table in section 3                      (0.90 - 1.08)
//   standing = 0.90 + 0.20 x the protocol's TVL rank within its own
//              category on this board (1.10 leads, 0.90 trails; no
//              category: 1.00)
//
// Only the snapshot's own figures feed it — TVL, seven-day growth, age
// since listed_at, chain count, category, and the category's own TVL
// order. No protocol name is ever special-cased: the same function scores
// every row, and the board is the rows sorted by what it returns.
//
// Why the shape changed from radar-2: growth now counts at full weight,
// because a week's growth is the freshest signal the snapshot carries and
// radar-2's 0.6 weight left it moving rows by only about 9%; maturity is
// a hump, not a climb, because a token is most likely while the protocol
// is proven but still young — a three-year tokenless run signals a team
// that will never launch — and standing compares each protocol with its
// own category, so a leader among lenders is not judged against a leader
// among bridges. TVL still sets the scale: no factor alone can lift a
// small protocol above a large one, but within a TVL band the other five
// decide the order.
//
// Why breadth and category at all: a protocol live on many chains has
// distribution a single-chain one does not, so breadth earns a small
// premium capped at 20%. Fee-earning categories (Dexs, Lending) earn a
// small premium; wrapped, bridged and staking products earn a discount,
// because their token — if one ever comes — captures less of the
// protocol's own value.

// ---------------------------------------------------------------------------
// 1. Shapes: the snapshot, the model, one board row, the dashboard's data.
// ---------------------------------------------------------------------------

/** One protocol as the sealed snapshot carries it: exactly ten fields. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard's model panel too. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_peak: number;
  maturity_peak_days: number;
  maturity_late: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  standing_floor: number;
  standing_range: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 1.0,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_peak: 1.0,
  maturity_peak_days: 540,
  maturity_late: 0.8,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.025,
  chain_max_extra: 8,
  standing_floor: 0.9,
  standing_range: 0.2,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 210;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Category multipliers: fee-earning categories up, wrapped/bridged down, else 1.00. */
export const CATEGORY_MULT: Record<string, number> = {
  Dexs: 1.08,
  Lending: 1.08,
  CDP: 1.08,
  Yield: 1.06,
  Derivatives: 1.05,
  'Risk Curators': 1.05,
  'Onchain Capital Allocator': 1.05,
  'Yield Aggregator': 1.04,
  'Basis Trading': 1.04,
  'Leveraged Farming': 1.04,
  'Liquidity Manager': 1.05,
  Farm: 1.04,
  RWA: 1.02,
  'Liquid Staking': 0.92,
  'Staking Pool': 0.92,
  Restaking: 0.92,
  Bridge: 0.9,
  'Canonical Bridge': 0.9,
  'Liquid Restaking': 0.92,
  'Restaked BTC': 0.92,
};

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    category_multiplier: number;
    standing_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  category_multiplier: number;
  standing_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------------------
// 2. Small helpers: dates, numbers, ordering.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `n` into [`lo`, `hi`]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Four-decimal rounding, for the multipliers the board records. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Slug order: the tie-break every sort in this file shares. */
function bySlug(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 3. The six factors, one function each.
// ---------------------------------------------------------------------------

/** Factor 1 — base value: a quarter of TVL, before any adjustment. */
export function baseValue(tvlUsd: number, model: ModelConstants): number {
  return tvlUsd * model.base_multiple;
}

/** The week's growth, clamped to the model's band; unreported growth reads as 0. */
export function clampedGrowth(change7d: number | null, model: ModelConstants): number {
  return clamp(numberOr(change7d, 0), model.growth_floor, model.growth_cap);
}

/** Factor 2 — growth: up 1.0% of implied value per point of weekly growth, at full weight. */
export function growthMultiplier(change7d: number | null, model: ModelConstants): number {
  return 1 + (clampedGrowth(change7d, model) / 100) * model.growth_weight;
}

/**
 * Factor 3 — maturity: a hump, not a climb. 0.60 for a newborn protocol,
 * rising to 1.00 at 540 days — proven, still young, the likeliest window
 * for a token — then easing to 0.80 after three years, when a long
 * tokenless run signals a team that will never launch.
 */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = clamp(age ?? model.unknown_age_days, 0, model.maturity_days);
  if (days <= model.maturity_peak_days) {
    return (
      model.maturity_floor +
      (days / model.maturity_peak_days) * (model.maturity_peak - model.maturity_floor)
    );
  }
  return (
    model.maturity_peak -
    ((days - model.maturity_peak_days) / (model.maturity_days - model.maturity_peak_days)) *
      (model.maturity_peak - model.maturity_late)
  );
}

/** Factor 4 — chain breadth: 1 + 0.025 per extra chain, capped at eight extra chains (1.00–1.20). */
export function chainMultiplier(chains: string[], model: ModelConstants): number {
  const extra = clamp(chains.length - 1, 0, model.chain_max_extra);
  return 1 + model.chain_step * extra;
}

/** Factor 5 — category: the table above; 1.00 when unlisted, 0.97 when none is named. */
export function categoryMultiplier(category: string | null): number {
  if (category === null) return 0.97;
  return CATEGORY_MULT[category] ?? 1.0;
}

/**
 * Factor 6 — standing: the protocol's TVL rank within its own category,
 * among the protocols given (the board's own set, so the dashboard can
 * recompute it from the rows it shows). The category leader scores the
 * full premium, the smallest a small discount, and a protocol with no
 * category named scores 1.00: it has no category to lead.
 */
export function standingMultipliers(
  protocols: SnapshotProtocol[],
  model: ModelConstants,
): Map<string, number> {
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of protocols) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }
  const out = new Map<string, number>();
  for (const list of byCategory.values()) {
    list.sort((a, b) => b.tvl_usd - a.tvl_usd || bySlug(a.slug, b.slug));
    list.forEach((p, i) => {
      out.set(p.slug, model.standing_floor + model.standing_range * (1 - i / list.length));
    });
  }
  return out;
}

/** One protocol's standing multiplier: 1.00 when it names no category. */
export function standingMultiplier(
  protocol: SnapshotProtocol,
  standings: Map<string, number>,
): number {
  if (protocol.category === null) return 1.0;
  return standings.get(protocol.slug) ?? 1.0;
}

/** Every factor at once, plus the implied value they multiply to. */
export interface ScoredProtocol {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  catMult: number;
  standingMult: number;
  age: number | null;
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  standings: Map<string, number> = new Map(),
): ScoredProtocol {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clampedGrowth(protocol.change_7d, model);
  const growthMult = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const chainMult = chainMultiplier(protocol.chains, model);
  const catMult = categoryMultiplier(protocol.category);
  const standingMult = standingMultiplier(protocol, standings);
  const implied = Math.max(
    1,
    Math.round(
      baseValue(protocol.tvl_usd, model) *
        growthMult *
        maturityMult *
        chainMult *
        catMult *
        standingMult,
    ),
  );
  return { implied, growthPct, growthMult, maturityMult, chainMult, catMult, standingMult, age };
}

// ---------------------------------------------------------------------------
// 4. Eligibility: which protocols the board may rank at all.
// ---------------------------------------------------------------------------

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocols by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// ---------------------------------------------------------------------------
// 5. Board assembly: watchlist first, then the early radar, then the ranking.
// ---------------------------------------------------------------------------

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every one of its protocols is on the board.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: the highest-TVL rankable protocols below the floor.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlug(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  // Standing is judged within the board's own set, so the dashboard can
  // recompute it from the rows it shows: the category order comes first,
  // then the scoring.
  const standings = standingMultipliers([...chosen.values()], model);
  const scored = [...chosen.values()].map((p) => ({
    p,
    score: impliedValue(p, snapshot.as_of, model, standings),
  }));
  scored.sort((a, b) => b.score.implied - a.score.implied || bySlug(a.p.slug, b.p.slug));
  return scored.map((s, i) => toBoardRow(s.p, s.score, i + 1, model));
}

/** One scored protocol, laid out as the board.json row the gate reads. */
function toBoardRow(
  p: SnapshotProtocol,
  s: ScoredProtocol,
  rank: number,
  model: ModelConstants,
): BoardRow {
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      category_multiplier: round4(s.catMult),
      standing_multiplier: round4(s.standingMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  };
}

// ---------------------------------------------------------------------------
// 6. Farm plans: nine concrete steps per protocol, derived from its record.
//    The action, the weekly action, the monitor and the exit are tables of
//    (category test, text), tried in order — the first test that matches
//    wins, exactly as the if-chain they replace did. The wallet and the gas
//    follow the protocol's first chain, the capital its TVL, the hold its
//    age. No name is special-cased, and no step assumes the protocol runs a
//    points program: where a step touches points or a claim, it says to
//    check whether one exists and to use only the link the protocol itself
//    publishes.
// ---------------------------------------------------------------------------

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The wallet family the protocol's first chain needs: EVM, Solana, Bitcoin or Cosmos. */
export type ChainFamily = 'EVM' | 'Solana' | 'Bitcoin' | 'Cosmos';

const COSMOS_CHAINS = new Set([
  'Cosmos Hub',
  'Osmosis',
  'Injective',
  'Sei',
  'Celestia',
  'Neutron',
  'dYdX',
  'Kava',
]);

export function chainFamily(chain: string): ChainFamily {
  if (chain === 'Solana') return 'Solana';
  if (chain === 'Bitcoin') return 'Bitcoin';
  if (COSMOS_CHAINS.has(chain)) return 'Cosmos';
  return 'EVM';
}

/** The wallet to open, by the chain's family: a fresh wallet either way, but a different one. */
function walletFor(family: ChainFamily, chain: string): string {
  if (family === 'Solana') {
    return `Open a fresh Solana wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`;
  }
  if (family === 'Bitcoin') {
    return `Open a fresh Bitcoin wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`;
  }
  if (family === 'Cosmos') {
    return `Open a fresh Cosmos wallet that supports ${chain} and holds only the funds you plan to farm, and keep its seed phrase offline.`;
  }
  return `Open a fresh EVM wallet that supports ${chain} and holds only the funds you plan to farm, and keep its seed phrase offline.`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Gas for one transaction, by the chain's family: Solana is cents, the rest dollars. */
function gasFor(family: ChainFamily, capital: number): number {
  if (family === 'Solana') return 1;
  if (family === 'Bitcoin') return 5;
  return capital >= 150 ? 8 : 4;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Why the hold lasts that long: a young protocol needs a full window, an old one a second snapshot. */
function holdReason(age: number | null): string {
  if (age === null) return 'so the activity is counted in more than one snapshot';
  if (age < 180) return 'so a young protocol sees a full qualifying window';
  if (age < 365) return 'so the activity spans more than one snapshot';
  return 'so the activity is counted in more than one snapshot';
}

interface FarmContext {
  p: SnapshotProtocol;
  capital: number;
  chain: string;
}

type ActionBuilder = (ctx: FarmContext) => string;

/** One row of the main-action table: a category test and the action it picks. */
interface ActionRule {
  test: (category: string) => boolean;
  build: ActionBuilder;
}

const MAIN_ACTIONS: ActionRule[] = [
  {
    test: (c) => c.includes('lend') || c.includes('cdp') || c.includes('collateral'),
    build: ({ p, capital, chain }) =>
      `Supply $${capital} of USDC to ${p.name} on ${chain} and keep the position open.`,
  },
  {
    test: (c) => c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'),
    build: ({ p, capital, chain }) =>
      `Provide $${capital} of liquidity to ${p.name}'s main pool on ${chain} and keep the position open.`,
  },
  {
    test: (c) => c.includes('bridge'),
    build: ({ p, capital, chain }) =>
      `Bridge $${capital} of USDC to ${chain} through ${p.name} and use the bridged funds in its app.`,
  },
  {
    test: (c) => c.includes('staking') || c.includes('restak'),
    build: ({ p, capital }) =>
      `Stake $${capital} of the chain's staking asset through ${p.name} and keep the receipt.`,
  },
  {
    test: (c) => c.includes('interest rate'),
    build: ({ p, capital, chain }) =>
      `Deposit $${capital} of USDC into ${p.name}'s fixed-rate market on ${chain} and hold it to maturity.`,
  },
  {
    test: (c) => c.includes('perpetual') || c.includes('derivative'),
    build: ({ p, capital }) =>
      `Deposit $${capital} of USDC as margin on ${p.name} and open one small hedge.`,
  },
  {
    test: (c) => c.includes('prediction'),
    build: ({ p, capital }) => `Fund $${capital} and place one market position on ${p.name}.`,
  },
  {
    test: (c) => c.includes('curator') || c.includes('allocator'),
    build: ({ p, capital, chain }) =>
      `Deposit $${capital} into a ${p.name} vault on ${chain} and keep the shares.`,
  },
  {
    test: (c) => c.includes('stable'),
    build: ({ p, capital, chain }) =>
      `Mint or deposit $${capital} of the stable asset through ${p.name} on ${chain}.`,
  },
  {
    test: (c) => c.includes('rwa'),
    build: ({ p, capital, chain }) =>
      `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
  },
  {
    test: (c) => c.includes('insurance'),
    build: ({ p, capital, chain }) =>
      `Buy $${capital} of cover from ${p.name} on ${chain} and keep the policy.`,
  },
  {
    test: (c) => c.includes('payment'),
    build: ({ p, capital, chain }) =>
      `Route $${capital} of payments through ${p.name} on ${chain} and keep the channel funded.`,
  },
  {
    test: (c) => c === 'chain',
    build: ({ p, capital, chain }) =>
      `Delegate $${capital} to a validator of ${p.name} on ${chain} and keep the delegation.`,
  },
  {
    test: (c) => c.includes('btc'),
    build: ({ p, capital, chain }) =>
      `Wrap $${capital} of BTC through ${p.name} on ${chain} and use the wrapped asset in its app.`,
  },
  {
    test: (c) => c.includes('index'),
    build: ({ p, capital, chain }) =>
      `Buy $${capital} of the ${p.name} index on ${chain} and hold the index token.`,
  },
  {
    test: (c) => c.includes('governance'),
    build: ({ p, capital, chain }) =>
      `Lock $${capital} of the governance asset in ${p.name} on ${chain} and vote once.`,
  },
  {
    test: (c) => c.includes('card'),
    build: ({ p, capital, chain }) =>
      `Load $${capital} onto the ${p.name} card from ${chain} and make one purchase.`,
  },
  {
    test: (c) => c.includes('cedefi'),
    build: ({ p, capital, chain }) =>
      `Deposit $${capital} of USDC into ${p.name}'s managed account on ${chain} and keep the position open.`,
  },
];

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of MAIN_ACTIONS) {
    if (rule.test(c)) return rule.build({ p, capital, chain });
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** A second position: on a second chain when the protocol has one, else a top-up a week later. */
function secondActionFor(p: SnapshotProtocol, half: number): string {
  if (p.chains.length >= 2) {
    return `Repeat the main position on ${p.chains[1]} with $${half} so the farm is counted on two chains, not one.`;
  }
  return `Top up the main position with another $${half} a week later so the farm shows repeat activity, not one deposit.`;
}

/** One row of the weekly-action table: a category test and the action it picks. */
interface WeeklyRule {
  test: (category: string) => boolean;
  build: () => string;
}

const WEEKLY_ACTIONS: WeeklyRule[] = [
  {
    test: (c) => c.includes('lend') || c.includes('cdp'),
    build: () => `Borrow $20 against the deposit and repay it the same week, so the position shows both sides.`,
  },
  {
    test: (c) => c.includes('dex'),
    build: () => `Swap $20 through the protocol's own pool and add $10 of liquidity if the pool allows it.`,
  },
  {
    test: (c) => c.includes('interest rate'),
    build: () => `Roll $20 of the fixed-rate position into a fresh term.`,
  },
  {
    test: (c) => c.includes('perpetual') || c.includes('derivative'),
    build: () => `Close the hedge and open a fresh small one, keeping the margin in place.`,
  },
  {
    test: (c) => c.includes('bridge'),
    build: () => `Bridge $20 to a second chain the protocol supports and use it in its app.`,
  },
  {
    test: (c) => c.includes('staking') || c.includes('restak'),
    build: () => `Restake the rewards the position earned and keep the receipt token.`,
  },
  {
    test: (c) => c.includes('prediction'),
    build: () => `Place one small market position and settle it before the week ends.`,
  },
  {
    test: (c) => c.includes('yield') || c.includes('curator') || c.includes('allocator'),
    build: () => `Harvest the yield the vault earned and redeposit it into the same vault.`,
  },
  {
    test: (c) => c.includes('stable'),
    build: () => `Move $20 of the stable asset in and out of the protocol so the position shows weekly use.`,
  },
  {
    test: (c) => c.includes('rwa'),
    build: () => `Check the yield the protocol paid this week and reinvest $20 of it.`,
  },
  {
    test: (c) => c.includes('insurance'),
    build: () => `Review the cover the protocol holds for your position and renew any part that lapsed.`,
  },
  {
    test: (c) => c.includes('payment'),
    build: () => `Send one $20 payment through the protocol and confirm it settles.`,
  },
  {
    test: (c) => c === 'chain',
    build: () => `Vote once on a governance proposal or re-delegate $20.`,
  },
  {
    test: (c) => c.includes('btc'),
    build: () => `Move $20 of the wrapped asset through the protocol's app and back.`,
  },
  {
    test: (c) => c.includes('index'),
    build: () => `Rebalance $20 into the index.`,
  },
  {
    test: (c) => c.includes('governance'),
    build: () => `Vote once on a protocol proposal.`,
  },
  {
    test: (c) => c.includes('card'),
    build: () => `Make one $20 purchase with the card.`,
  },
  {
    test: (c) => c.includes('cedefi'),
    build: () => `Check the managed position the protocol reports and add $20.`,
  },
];

/** The weekly qualifying action, by category: the same kind of use the protocol rewards. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of WEEKLY_ACTIONS) {
    if (rule.test(c)) return rule.build();
  }
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`;
}

/** One row of the monitor table: a category test and what to watch each week. */
interface MonitorRule {
  test: (category: string) => boolean;
  build: (p: SnapshotProtocol) => string;
}

const MONITOR_ACTIONS: MonitorRule[] = [
  {
    test: (c) => c.includes('lend') || c.includes('cdp') || c.includes('collateral'),
    build: (p) =>
      `Check the borrow rate and the health factor of your ${p.name} position once a week; top it up before it nears liquidation.`,
  },
  {
    test: (c) => c.includes('dex'),
    build: (p) =>
      `Check the pool's price range and the fees your ${p.name} position earned once a week; rebalance if it drifts out of range.`,
  },
  {
    test: (c) => c.includes('interest rate'),
    build: (p) => `Check the fixed rate ${p.name} pays and the term left once a week.`,
  },
  {
    test: (c) => c.includes('perpetual') || c.includes('derivative'),
    build: (p) =>
      `Check the funding rate and your margin on ${p.name} once a week; add margin before a funding spike liquidates the hedge.`,
  },
  {
    test: (c) => c.includes('bridge'),
    build: (p) =>
      `Check ${p.name}'s supported routes and finality once a week; a route that stalls is a reason to wait, not to retry blindly.`,
  },
  {
    test: (c) => c.includes('staking') || c.includes('restak'),
    build: (p) =>
      `Check the staking APR and the validator ${p.name} uses once a week; a validator that misses blocks is a reason to switch.`,
  },
  {
    test: (c) => c.includes('prediction'),
    build: (p) => `Check whether your ${p.name} market resolved once a week and settle it before the week ends.`,
  },
  {
    test: (c) => c.includes('yield') || c.includes('curator') || c.includes('allocator'),
    build: (p) =>
      `Check the vault APY and strategy ${p.name} reports once a week; a strategy change is a reason to re-read the plan.`,
  },
  {
    test: (c) => c.includes('stable'),
    build: (p) => `Check the stable asset's peg on ${p.name} once a week; a depeg is a reason to exit, not to add.`,
  },
  {
    test: (c) => c.includes('rwa'),
    build: (p) =>
      `Check the backing and redemption terms ${p.name} publishes once a week; a redemption pause is a reason to wait.`,
  },
  {
    test: (c) => c.includes('insurance'),
    build: (p) => `Check the cover ${p.name} holds and its expiry once a week; renew before it lapses.`,
  },
  {
    test: (c) => c.includes('payment'),
    build: (p) => `Check that your ${p.name} channel stays funded once a week; top it up before it runs dry.`,
  },
  {
    test: (c) => c === 'chain',
    build: (p) =>
      `Check ${p.name}'s validator set and governance votes once a week; a missed vote is a missed signal.`,
  },
  {
    test: (c) => c.includes('btc'),
    build: (p) => `Check the wrapped asset's peg on ${p.name} once a week; a depeg is a reason to exit.`,
  },
  {
    test: (c) => c.includes('index'),
    build: (p) => `Check the ${p.name} index composition once a week; a rebalance is a reason to re-read the weights.`,
  },
  {
    test: (c) => c.includes('governance'),
    build: (p) => `Check ${p.name}'s open proposals once a week and vote on any that touch your lock.`,
  },
  {
    test: (c) => c.includes('card'),
    build: (p) => `Check the ${p.name} card balance and its limits once a week.`,
  },
  {
    test: (c) => c.includes('cedefi'),
    build: (p) => `Check the managed position and fees ${p.name} reports once a week.`,
  },
];

/**
 * What to watch each week, by category — and the points caveat: a points
 * program is checked only where the protocol publishes one. Most
 * protocols run none, so the on-chain position is the record, never a
 * third-party points site.
 */
function monitorFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of MONITOR_ACTIONS) {
    if (rule.test(c)) {
      return `${rule.build(p)} If ${p.name} publishes a points or rewards page, confirm the position is counted there; if it publishes none, the on-chain position is the record.`;
    }
  }
  return `Check the position ${p.name} shows for your wallet once a week; a position that stops counting is a reason to re-read its rules. If ${p.name} publishes a points or rewards page, confirm the position is counted there; if it publishes none, the on-chain position is the record.`;
}

/** One row of the exit table: a category test and how to unwind. */
interface ExitRule {
  test: (category: string) => boolean;
  build: (p: SnapshotProtocol) => string;
}

const EXIT_ACTIONS: ExitRule[] = [
  {
    test: (c) => c.includes('lend') || c.includes('cdp') || c.includes('collateral'),
    build: (p) => `Repay any borrow on ${p.name} first, then withdraw the supply.`,
  },
  {
    test: (c) => c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'),
    build: (p) => `Remove the liquidity from ${p.name}'s pool and collect the fees.`,
  },
  {
    test: (c) => c.includes('interest rate'),
    build: (p) => `Let the fixed term on ${p.name} mature, then withdraw.`,
  },
  {
    test: (c) => c.includes('perpetual') || c.includes('derivative'),
    build: (p) => `Close the hedge on ${p.name} and withdraw the margin.`,
  },
  {
    test: (c) => c.includes('bridge'),
    build: (p) => `Bridge the funds back through ${p.name} to your starting chain.`,
  },
  {
    test: (c) => c.includes('staking') || c.includes('restak'),
    build: (p) => `Unstake through ${p.name} and wait out its unbonding period.`,
  },
  {
    test: (c) => c.includes('prediction'),
    build: (p) => `Settle the open market position on ${p.name} and withdraw.`,
  },
  {
    test: (c) => c.includes('yield') || c.includes('curator') || c.includes('allocator'),
    build: (p) => `Redeem the vault shares on ${p.name} and withdraw.`,
  },
  {
    test: (c) => c.includes('stable'),
    build: (p) => `Redeem the stable asset through ${p.name} back to USDC.`,
  },
  {
    test: (c) => c.includes('rwa'),
    build: (p) => `Redeem the yield asset through ${p.name}.`,
  },
  {
    test: (c) => c.includes('insurance'),
    build: (p) => `Let the cover on ${p.name} expire or cancel it, then withdraw.`,
  },
  {
    test: (c) => c.includes('payment'),
    build: (p) => `Close the ${p.name} channel and settle the balance back to your wallet.`,
  },
  {
    test: (c) => c === 'chain',
    build: (p) => `Undelegate from ${p.name} and wait out its unbonding period.`,
  },
  {
    test: (c) => c.includes('btc'),
    build: (p) => `Unwrap the asset through ${p.name} back to BTC.`,
  },
  {
    test: (c) => c.includes('index'),
    build: (p) => `Sell the ${p.name} index position back to USDC.`,
  },
  {
    test: (c) => c.includes('governance'),
    build: (p) => `Unlock the governance asset on ${p.name} once the lock ends.`,
  },
  {
    test: (c) => c.includes('card'),
    build: (p) => `Spend down or withdraw the ${p.name} card balance.`,
  },
  {
    test: (c) => c.includes('cedefi'),
    build: (p) => `Withdraw the managed position from ${p.name}.`,
  },
];

/**
 * How to leave, by category — and the claim caveat: a claim exists only
 * where the protocol publishes one, so the step names the unwind first
 * and the claim second, and never pays a fee to claim.
 */
function exitFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of EXIT_ACTIONS) {
    if (rule.test(c)) {
      return `${rule.build(p)} Claim only from the link ${p.name} itself publishes, and never pay a fee to claim.`;
    }
  }
  return `Withdraw the position from ${p.name}. Claim only from the link ${p.name} itself publishes, and never pay a fee to claim.`;
}

/**
 * A protocol's farm plan: nine steps, each an action with a cost and a time.
 * Derived from the protocol's own record (category, chains, TVL, age), never
 * from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const family = chainFamily(chain);
  const capital = capitalFor(p);
  const half = Math.max(10, Math.floor(capital / 2));
  const hold = holdDaysFor(age);
  const gas = gasFor(family, capital);
  const reserve = family === 'Solana' ? 1 : 5;
  return [
    {
      text: walletFor(family, chain),
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Move $${capital} of USDC to your farm wallet on ${chain} and keep $${reserve} aside for gas on that chain.`,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '10 minutes to fund',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, half),
      cost: `$${half} of capital and about $3 of gas`,
      time: '15 minutes',
    },
    { text: weeklyFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    {
      text: monitorFor(p),
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days ${holdReason(age)}.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: exitFor(p),
      cost: 'no fee to claim, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the ${chain} chain, the ${p.category ?? 'uncategorised'} position, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------------------
// 7. The live set and the dashboard's dataset.
// ---------------------------------------------------------------------------

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_multiplier: row.model.category_multiplier,
    standing_multiplier: row.model.standing_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------------------
// 8. Reading the snapshot: strict shape checks, one clear error each.
// ---------------------------------------------------------------------------

/** A JSON value that must be an object, or the error the caller reports. */
function asObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotError(`snapshot.json's ${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

/** One protocol entry out of the snapshot's array, with missing fields made safe. */
function parseProtocol(value: unknown, i: number): SnapshotProtocol {
  const p = asObject(value, `protocol ${i}`);
  if (
    typeof p.slug !== 'string' ||
    typeof p.name !== 'string' ||
    typeof p.tvl_usd !== 'number' ||
    !Number.isFinite(p.tvl_usd)
  ) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  return {
    slug: p.slug,
    name: p.name,
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains)
      ? p.chains.filter((c): c is string => typeof c === 'string')
      : [],
    tvl_usd: p.tvl_usd,
    change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols: o.protocols.map((v, i) => parseProtocol(v, i)),
    watchlist: o.watchlist as string[],
  };
}

// ---------------------------------------------------------------------------
// 9. The gate's own self-check, run before main.ts writes anything.
// ---------------------------------------------------------------------------

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (
    board.length >= 2 &&
    board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd
  ) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 10. The dashboard's dataset, as one script: no fetch, no network.
// ---------------------------------------------------------------------------

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
