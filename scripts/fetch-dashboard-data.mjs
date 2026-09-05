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
const BACKOFF_BASE_MS = 5_000;       // 5s -> 15s -> 45s
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

async function get(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json', Authorization: KEY },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { data: json.data ?? [], pagination: json.pagination ?? null };
}

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

// --- 1. Recycle fills (SN28 -> SN90 swaps by our coldkey) ---
// Amounts are in RAO (1 TAO = 1e9 RAO) and alpha units (1 alpha = 1e9).
const fills = await getPaginated(
  `/api/dtao/trade/v1?coldkey=${KUBETEE_COLDKEY}` +
    `&from_name=SN28&to_name=SN90&order=timestamp_desc&limit=50`,
);
const recycle = fills.map((t) => ({
  ts: t.timestamp,
  block: t.block_number,
  extrinsic: t.extrinsic_id,
  sn28Alpha: Number(t.from_amount) / 1e9,
  sn90Alpha: Number(t.to_amount) / 1e9,
  taoValue: Number(t.tao_value) / 1e9,
  usdValue: Number(t.usd_value),
  link: `https://www.tao.app/extrinsic/${t.extrinsic_id}`,
}));

const totals = recycle.reduce(
  (acc, r) => ({
    sn28Alpha: acc.sn28Alpha + r.sn28Alpha,
    sn90Alpha: acc.sn90Alpha + r.sn90Alpha,
    taoValue: acc.taoValue + r.taoValue,
    usdValue: acc.usdValue + r.usdValue,
  }),
  { sn28Alpha: 0, sn90Alpha: 0, taoValue: 0, usdValue: 0 },
);

// --- 2. SN28 metagraph — every registered hotkey ---
// Note: emission / daily_mining_alpha / alpha_stake are in RAO-scale units
// (1e9 = 1.0). incentive is a 0..1 fraction.
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
    hotkeys: sn28,
  },
};
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log(
  `fetch-dashboard-data: ${recycle.length} recycle fills, ` +
    `${sn28.length} SN28 hotkeys -> ${OUT}`,
);
