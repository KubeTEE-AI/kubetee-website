// Fetches live on-chain data for the /dashboard page at build time.
//
// Sources (TaoStats REST API — key in TAOSTATS_API_KEY env):
//   1. dTAO trades: our coldkey's SN28 -> SN90 swap fills (the daily recycle)
//   2. Metagraph: all hotkeys registered on SN28
//
// Output: src/data/dashboard.json — committed to the repo so the static
// build never needs the API at request time. Re-run via the dashboard-data
// GitHub Action (cron + dispatch) to refresh.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'data', 'dashboard.json');

const API = 'https://api.taostats.io';
const KEY = process.env.TAOSTATS_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

// --- Tunables (see docs/superpowers/specs/2026-09-05-dashboard-auto-update-design.md) ---
const REQUEST_TIMEOUT_MS = 30_000;   // per-request timeout
const MAX_ATTEMPTS = 3;              // per-request retry cap
const BACKOFF_BASE_MS = 5_000;       // 5s -> 15s (with MAX_ATTEMPTS=3)
const SETTLE_POLL_INTERVAL_MS = 15 * 60_000;  // 15 min between settle polls
const SETTLE_WINDOW_MS = 2 * 60 * 60_000;     // 2h settle window
const RECYCLE_RUN_SLACK_MS = 30 * 60_000;     // slack before today's 00:00 UTC
const MIN_ORIGIN_TAO = 1.0;          // recycler's MIN_ORIGIN_TAO
const METAGRAPH_SANITY_FLOOR = 100;  // hotkey count sanity floor (~250 today)

if (!KEY) {
  console.error('fetch-dashboard-data: TAOSTATS_API_KEY not set');
  process.exit(1);
}

// The KubeTEE owner coldkey — the account that swaps SN28 miner alpha
// to SN90 and recycles it.
const KUBETEE_COLDKEY = '5C9y6fnLPSzBeh1Np7f4DnGen42xV29nL9qZTDuwpVC4iTEE';
// Our sayGM miner hotkey on SN28 (uid 44) — highlighted in the table.
const KUBETEE_SN28_HOTKEY =
  '5EvosuiYGEf8xqDfHVyQcyPD1BjN1fDjyqLdhHMRMawPo42Y';

// --- HTTP layer with retry (timeout, 429 Retry-After, 5xx backoff) ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getOnce(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json', Authorization: KEY },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`GET ${path} -> ${res.status} ${body}`);
    err.status = res.status;
    const raRaw = res.headers.get('retry-after');
    const raSeconds = raRaw != null ? Number(raRaw) : NaN;
    err.retryAfterMs = Number.isFinite(raSeconds) && raSeconds > 0
      ? Math.min(raSeconds * 1000, 60_000)
      : null;
    throw err;
  }
  const json = await res.json();
  return { data: json.data ?? [], pagination: json.pagination ?? null };
}

async function get(path) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await getOnce(path);
    } catch (err) {
      lastErr = err;
      const retriable = err.name === 'TimeoutError'
        || err.name === 'AbortError'
        || (err.status >= 500)
        || (err.status === 429)
        || (err instanceof TypeError); // fetch network errors: ECONNREFUSED/ECONNRESET/DNS — no .status
      if (!retriable || attempt === MAX_ATTEMPTS) throw err;
      const delay = err.retryAfterMs
        ?? BACKOFF_BASE_MS * 3 ** (attempt - 1);
      console.warn(
        `fetch-dashboard-data: GET ${path} failed (${err.message}), ` +
          `retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(delay / 1000)}s`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

// TODO: maxPages=5 caps the metagraph at 250 hotkeys (50/page) and fills at 250
// rows. SN28 is at 250/256 slots — bump maxPages when the subnet fills up.
async function getPaginated(path, maxPages = 5) {
  const all = [];
  let page = 1;
  while (page <= maxPages) {
    const sep = path.includes('?') ? '&' : '?';
    const { data, pagination } = await get(`${path}${sep}page=${page}`);
    all.push(...data);
    if (!pagination?.next_page) break;
    page = pagination.next_page;
  }
  return all;
}

// --- Settle logic ---
// S1: today's recycle fill is visible (newest fill >= today 00:00 UTC - slack)
// S2: legitimate skip day — our SN28 stake x price < MIN_ORIGIN_TAO

async function getFills({ light = false } = {}) {
  // light mode (settle polling): page 1 only — enough to check the newest fill.
  // Full mode (post-settle): all pages (limit 50/page, max 5).
  const path =
    `/api/dtao/trade/v1?coldkey=${KUBETEE_COLDKEY}` +
    `&from_name=SN28&to_name=SN90&order=timestamp_desc&limit=50`;
  if (light) {
    const { data } = await get(`${path}&page=1`);
    return data;
  }
  return getPaginated(path);
}

function todayUtcMidnight() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function mapFill(t) {
  return {
    ts: t.timestamp,
    block: t.block_number,
    extrinsic: t.extrinsic_id,
    sn28Alpha: Number(t.from_amount) / 1e9,
    sn90Alpha: Number(t.to_amount) / 1e9,
    taoValue: Number(t.tao_value) / 1e9,
    usdValue: Number(t.usd_value),
    link: `https://www.tao.app/extrinsic/${t.extrinsic_id}`,
  };
}

function sn28PriceFromFill(fill) {
  if (!fill || !fill.sn28Alpha || fill.sn28Alpha <= 0) return null;
  return fill.taoValue / fill.sn28Alpha;
}

async function fetchSn28PoolPrice() {
  const { data } = await get('/api/dtao/pool/latest/v1?netuid=28');
  const row = data?.[0];
  if (!row) return null;
  const price = Number(row.price);
  if (Number.isFinite(price) && price > 0) return price;
  // fallback within the pool payload: total_tao (RAO) / alpha_in_pool (human-scale)
  const alpha = Number(row.alpha_in_pool);
  const tao = Number(row.total_tao);
  if (Number.isFinite(alpha) && Number.isFinite(tao) && alpha > 0) {
    return (tao / 1e9) / alpha;
  }
  return null;
}

async function fetchOurStake() {
  // metagraph page 1 (uid_asc, limit 50) — UID 44 is on page 1
  const { data } = await get(
    '/api/metagraph/latest/v1?netuid=28&order=uid_asc&limit=50&page=1',
  );
  const ours = data.find((n) => n.hotkey?.ss58 === KUBETEE_SN28_HOTKEY);
  if (!ours) return { found: false, stake: null };
  return { found: true, stake: Number(ours.total_alpha_stake) / 1e9 };
}

async function evaluateSettle() {
  const fills = await getFills({ light: true });
  const newestFill = fills[0] ?? null;
  const cutoff = todayUtcMidnight() - RECYCLE_RUN_SLACK_MS;

  // S1 — today's fill is visible
  if (newestFill && Date.parse(newestFill.timestamp) >= cutoff) {
    return { settled: true, reason: 'S1', fills, stakeInfo: null, price: null };
  }

  // S2 — skip day: stake below the recycler's minimum
  const stakeInfo = await fetchOurStake();
  let price = await fetchSn28PoolPrice();
  if (price == null && newestFill) price = sn28PriceFromFill(mapFill(newestFill));
  if (
    stakeInfo.found
    && Number.isFinite(stakeInfo.stake)
    && Number.isFinite(price)
    && stakeInfo.stake * price < MIN_ORIGIN_TAO
  ) {
    return { settled: true, reason: 'S2', fills, stakeInfo, price };
  }

  return { settled: false, reason: 'unsettled', fills, stakeInfo, price };
}

// --- Main flow ---
async function pollUntilSettled() {
  const deadline = Date.now() + SETTLE_WINDOW_MS;
  for (;;) {
    let verdict;
    try {
      verdict = await evaluateSettle();
    } catch (err) {
      if (Date.now() >= deadline) {
        console.error(
          'fetch-dashboard-data: settle window expired with API errors — ' +
            `last error: ${err.message}`,
        );
        process.exit(1);
      }
      console.warn(
        `fetch-dashboard-data: settle-check failed (${err.message}); ` +
          `retrying in ${SETTLE_POLL_INTERVAL_MS / 60000}min`,
      );
      await sleep(SETTLE_POLL_INTERVAL_MS);
      continue;
    }
    console.log(
      `settle-check: reason=${verdict.reason} ` +
        `newest=${verdict.fills[0]?.timestamp ?? 'none'} ` +
        `stake=${verdict.stakeInfo?.stake ?? 'n/a'} price=${verdict.price ?? 'n/a'}`,
    );
    if (verdict.settled) return verdict;
    if (Date.now() >= deadline) {
      console.error(
        `fetch-dashboard-data: settle window (${SETTLE_WINDOW_MS / 60000}min) expired ` +
          'without S1 (today\u2019s fill) or S2 (stake below recycler minimum). ' +
          'Not publishing stale data. Investigate: TaoStats indexer lag, or the ' +
          'alpha-recycler CronJob failed with \u22651 TAO unswapped.',
      );
      process.exit(1);
    }
    await sleep(SETTLE_POLL_INTERVAL_MS);
  }
}

const settled = await pollUntilSettled();

// Full fills fetch (all pages) + full metagraph fetch (once, post-settle)
const fullFills = await getFills();
const neurons = await getPaginated(
  '/api/metagraph/latest/v1?netuid=28&order=uid_asc&limit=50',
);
const sn28 = neurons.map((n) => ({
  uid: n.uid,
  hotkey: n.hotkey.ss58,
  coldkey: n.coldkey.ss58,
  incentive: Number(n.incentive),
  emission: Number(n.emission) / 1e9,
  dailyMiningAlpha: n.daily_mining_alpha ? Number(n.daily_mining_alpha) / 1e9 : null,
  alphaStake: Number(n.total_alpha_stake) / 1e9,
  validatorPermit: n.validator_permit,
  isOwner: n.is_owner_hotkey === true,
  isKubeTEE: n.hotkey.ss58 === KUBETEE_SN28_HOTKEY,
  active: n.active,
  rank: n.rank,
  registeredAtBlock: n.registered_at_block,
  link: `https://taostats.io/neurons?netuid=28&uid=${n.uid}`,
}));

const recycle = fullFills.map(mapFill);
const totals = recycle.reduce(
  (acc, r) => ({
    sn28Alpha: acc.sn28Alpha + r.sn28Alpha,
    sn90Alpha: acc.sn90Alpha + r.sn90Alpha,
    taoValue: acc.taoValue + r.taoValue,
    usdValue: acc.usdValue + r.usdValue,
  }),
  { sn28Alpha: 0, sn90Alpha: 0, taoValue: 0, usdValue: 0 },
);

// Our hotkey's metagraph row — the only one stored/published (2026-09-05
// amendment: SN28 section shows only our miner). Validation still runs on
// the FULL metagraph.
const ourRow = sn28.find((n) => n.isKubeTEE);

// --- Validation (atomic: nothing written unless all pass) ---
if (!Array.isArray(recycle) || recycle.length === 0) {
  console.error('fetch-dashboard-data: fills empty or not an array');
  process.exit(1);
}
if (sn28.length < METAGRAPH_SANITY_FLOOR) {
  console.error(
    `fetch-dashboard-data: metagraph count ${sn28.length} < floor ${METAGRAPH_SANITY_FLOOR}`,
  );
  console.error('Possible pagination breakage — not writing.');
  process.exit(1);
}
if (!sn28.some((n) => n.isKubeTEE)) {
  console.error(
    `fetch-dashboard-data: our hotkey ${KUBETEE_SN28_HOTKEY.slice(0, 8)}… not found in metagraph`,
  );
  process.exit(1);
}
if (
  settled.reason === 'S2'
  && !(Number.isFinite(settled.stakeInfo?.stake) && Number.isFinite(settled.price))
) {
  console.error('fetch-dashboard-data: S2 settle with non-finite stake/price');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('dry-run: settled, not writing. Verdict:', {
    reason: settled.reason,
    newestFill: fullFills[0]?.timestamp ?? 'none',
    fillCount: recycle.length,
    hotkeyCount: sn28.length,
    stake: settled.stakeInfo?.stake ?? 'n/a',
    price: settled.price ?? 'n/a',
  });
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  coldkey: KUBETEE_COLDKEY,
  recycle: {
    fills: recycle,
    totals: {
      ...totals,
      count: recycle.length,
    },
  },
  sn28: {
    count: sn28.length,
    hotkeys: ourRow ? [ourRow] : [],
  },
};
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log(
  `fetch-dashboard-data: settled=${settled.reason} ${recycle.length} fills, ` +
    `${sn28.length} SN28 hotkeys (${ourRow ? 'ours only published' : 'OURS MISSING'}) -> ${OUT}`,
);
