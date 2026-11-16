import rawDashboard from "../data/dashboard.json";

export type Fill = {
  ts: string;
  block: number;
  extrinsic: string;
  sn28Alpha: number;
  sn90Alpha: number;
  taoValue: number;
  usdValue: number | null;
  link: string;
};

type Miner = {
  uid: number;
  hotkey: string;
  incentive: number;
  dailyMiningAlpha: number | null;
  alphaStake: number;
  isKubeTEE: boolean;
  link: string;
};

type RawDashboard = {
  generatedAt: string;
  recycle: {
    fills: Fill[];
  };
  sn28: {
    count: number;
    hotkeys: Miner[];
  };
};

export type DailyPoint = {
  date: string;
  label: string;
  usd: number;
  fills: number;
};

type WindowSummary = {
  start: string;
  end: string;
  days: number;
  totalUsd: number;
  activeDays: number;
  series: DailyPoint[];
  peak: DailyPoint | null;
};

export type DashboardSummary = {
  generatedAt: string;
  fills: Fill[];
  totals: {
    sn28Alpha: number;
    sn90Alpha: number;
    usdValue: number;
    count: number;
    usdMissing: number;
  };
  latestFill: Fill | null;
  oldestFill: Fill | null;
  spanDays: number;
  activeDays: number;
  window: WindowSummary;
  deltaPct: number | null;
  miner: Miner | null;
  sn28Count: number;
};

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

const raw = rawDashboard as unknown as RawDashboard;

const monthDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const numberFormatter = new Intl.NumberFormat("en-US");

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdExactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function isValidTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function toUtcDayKey(iso: string): string {
  if (!isValidTime(iso)) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

function dayStartUtc(key: string): number {
  return Date.parse(`${key}T00:00:00.000Z`);
}

function shiftDayKey(key: string, days: number): string {
  return new Date(dayStartUtc(key) + days * DAY_MS).toISOString().slice(0, 10);
}

function formatDayKey(key: string): string {
  if (!key) return "—";
  return monthDayFormatter.format(new Date(`${key}T00:00:00.000Z`));
}

function buildWindow(fills: Fill[], endKey: string, days = WINDOW_DAYS): WindowSummary {
  if (!endKey) {
    return {
      start: "",
      end: "",
      days,
      totalUsd: 0,
      activeDays: 0,
      series: [],
      peak: null,
    };
  }

  const endMs = dayStartUtc(endKey);
  const startMs = endMs - (days - 1) * DAY_MS;
  const buckets = new Map<string, { usd: number; fills: number }>();

  for (let index = 0; index < days; index += 1) {
    const key = new Date(startMs + index * DAY_MS).toISOString().slice(0, 10);
    buckets.set(key, { usd: 0, fills: 0 });
  }

  for (const fill of fills) {
    const key = toUtcDayKey(fill.ts);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.usd += fill.usdValue ?? 0;
    bucket.fills += 1;
  }

  const series: DailyPoint[] = [...buckets.entries()].map(([date, bucket]) => ({
    date,
    label: formatDayKey(date),
    usd: bucket.usd,
    fills: bucket.fills,
  }));

  const totalUsd = series.reduce((sum, point) => sum + point.usd, 0);
  const activeDays = series.filter((point) => point.fills > 0).length;

  let peak: DailyPoint | null = null;
  for (const point of series) {
    if (point.usd <= 0) continue;
    if (peak === null || point.usd > peak.usd) peak = point;
  }

  return {
    start: series[0]?.date ?? "",
    end: series[series.length - 1]?.date ?? "",
    days,
    totalUsd,
    activeDays,
    series,
    peak,
  };
}

function normaliseFills(fills: Fill[]): Fill[] {
  if (!Array.isArray(fills)) return [];

  return fills
    .filter((fill) => fill != null && isValidTime(fill.ts))
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.ts) - Date.parse(a.ts) ||
        (b.block ?? 0) - (a.block ?? 0) ||
        a.extrinsic.localeCompare(b.extrinsic),
    );
}

function getDashboardSummary(data: RawDashboard = raw): DashboardSummary {
  const fills = normaliseFills(data.recycle?.fills ?? []);
  const latestFill = fills[0] ?? null;
  const oldestFill = fills[fills.length - 1] ?? null;

  let sn28Alpha = 0;
  let sn90Alpha = 0;
  let usdValue = 0;
  let usdMissing = 0;

  for (const fill of fills) {
    sn28Alpha += Number.isFinite(fill.sn28Alpha) ? fill.sn28Alpha : 0;
    sn90Alpha += Number.isFinite(fill.sn90Alpha) ? fill.sn90Alpha : 0;
    if (fill.usdValue == null) {
      usdMissing += 1;
    } else if (Number.isFinite(fill.usdValue)) {
      usdValue += fill.usdValue;
    }
  }

  const latestKey = latestFill ? toUtcDayKey(latestFill.ts) : "";
  const oldestKey = oldestFill ? toUtcDayKey(oldestFill.ts) : "";
  const window = buildWindow(fills, latestKey, WINDOW_DAYS);
  const previous = window.start
    ? buildWindow(fills, shiftDayKey(window.start, -1), WINDOW_DAYS)
    : buildWindow(fills, "", WINDOW_DAYS);

  const activeDays = new Set(fills.map((fill) => toUtcDayKey(fill.ts))).size;
  const spanDays =
    latestKey && oldestKey
      ? Math.round((dayStartUtc(latestKey) - dayStartUtc(oldestKey)) / DAY_MS) + 1
      : 0;

  const deltaPct =
    previous.totalUsd > 0
      ? ((window.totalUsd - previous.totalUsd) / previous.totalUsd) * 100
      : null;

  const miner = data.sn28?.hotkeys?.find((row) => row.isKubeTEE) ?? data.sn28?.hotkeys?.[0] ?? null;

  return {
    generatedAt: data.generatedAt ?? "",
    fills,
    totals: {
      sn28Alpha,
      sn90Alpha,
      usdValue,
      count: fills.length,
      usdMissing,
    },
    latestFill,
    oldestFill,
    spanDays,
    activeDays,
    window,
    deltaPct,
    miner,
    sn28Count: data.sn28?.count ?? 0,
  };
}

export const dashboardSummary = getDashboardSummary();

export function formatUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return usdFormatter.format(value);
}

export function formatUsdExact(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return usdExactFormatter.format(value);
}

export function formatUsdAxis(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) {
    const thousands = value / 1000;
    const digits = Number.isInteger(thousands) ? 0 : 1;
    return `$${thousands.toFixed(digits)}k`;
  }
  return `$${numberFormatter.format(Math.round(value))}`;
}

export function formatAlpha(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatTao(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatShare(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function formatDelta(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso || !isValidTime(iso)) return "—";
  return dateFormatter.format(new Date(iso));
}

export function formatDateRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  if (!startIso || !endIso || !isValidTime(startIso) || !isValidTime(endIso)) {
    return "—";
  }
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = sameYear ? monthDayFormatter.format(start) : dateFormatter.format(start);
  return `${startLabel} – ${dateFormatter.format(end)}`;
}

export function shortKey(value: string | null | undefined, head = 10, tail = 7): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
