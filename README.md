# kubetee-website

The public KubeTEE website — [kubetee.ai](https://kubetee.ai). A static Astro site with the KubeTEE landing page and the SN28 → SN90 alpha recycle dashboard. Depth lives in [kubetee-subnet](https://github.com/KubeTEE-AI/kubetee-subnet).

## Stack

- Astro 5 — static output
- Tailwind CSS 4 via `@tailwindcss/vite`, with design tokens in `src/styles/global.css`
- anime.js 4 for the hero cube and architecture-pipeline motion
- Self-hosted Inter and IBM Plex Mono via Fontsource
- No UI framework

## Pages

- `/` — landing page: what KubeTEE is, the four pillars, how a request reaches an attested guest, live services, roadmap, and FAQ.
- `/dashboard` — evidence-first SN28 → SN90 recycle ledger: lifetime metrics, a 30-day chart, every fill with its extrinsic, and the SN28 operator panel.
- `/dashboard.json` — the committed snapshot the dashboard renders, served as JSON.
- `/manifest.webmanifest` — app manifest; install is offered in the footer when the browser supports it.
- `/llms.txt` — machine-readable site summary.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm lint       # ESLint (JS, TS, Astro)
pnpm format     # Prettier (JS, TS, Astro, CSS, JSON, MD, YAML)
pnpm check      # astro check (types and templates)
pnpm build      # static output in dist/
pnpm preview
```

Use `pnpm lint:fix` and `pnpm format:check` as the non-mutating counterparts. The same checks run in `.github/workflows/quality.yml` on every push and pull request.

## Dashboard data

The dashboard is statically rendered; it imports `src/data/dashboard.json` at build time and never calls the API at request time.

Refresh the snapshot before deploying:

```bash
TAOSTATS_API_KEY=... pnpm dashboard:data
pnpm build
pnpm check:align
```

`dashboard:data` fetches the TaoStats v1 API, waits for the daily recycle to settle (S1: today's fill is visible; S2: legitimate skip day), validates the result, and writes both `src/data/dashboard.json` and `public/dashboard.json`. It refuses to publish a malformed or unreconciled snapshot. `check:align` verifies that table headers and cells share the same alignment in the built dashboard.

- The 30-day window is 30 UTC calendar days ending on the latest fill day; the KPI and chart use the same window, and the comparison is the immediately preceding 30 days.
- USD values are TaoStats market estimates for the swaps, not audited fiat revenue.
- Every fill links to its extrinsic; totals are recomputed from the fills.
- The SN28 panel publishes only KubeTEE's own miner; the full metagraph is still validated.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) builds on every push to `main` and deploys to GitHub Pages. The custom domain `kubetee.ai` is served from `public/CNAME`; DNS is DNS-only (grey cloud) in Cloudflare.

`.github/workflows/dashboard-data.yml` refreshes the snapshot daily at 01:17 UTC, commits both JSON copies, and dispatches the deploy workflow (pushes made with `GITHUB_TOKEN` do not trigger other workflows).

## Structure

```text
src/pages/               index, dashboard, 404
src/layouts/             Layout: metadata, JSON-LD, header/footer, PWA wiring
src/components/layout/   site header (mobile dialog nav), footer
src/components/sections/ landing sections
src/components/visuals/  sealed cube and protection assets
src/components/dashboard/ metrics, chart, daily values, ledger, operator
src/components/ui/       shared primitives
src/content/             site and dashboard copy
src/data/                committed dashboard snapshot
src/lib/                 dashboard derivations, links, structured data
src/styles/              Tailwind theme and global component styles
scripts/                 fetch and validation scripts
public/                  brand assets, icons, manifest, sw.js, llms.txt, dashboard.json
```

## SEO and app metadata

- Per-route canonical, Open Graph, and Twitter metadata. Open Graph intentionally uses the small `/logo.png` icon with a `summary` card and description.
- JSON-LD: Organization, WebSite, Service, and WebPage on `/`; Organization, WebSite, WebPage, BreadcrumbList, and Dataset on `/dashboard`.
- `robots.txt` allows crawling; `sitemap-index.xml` lists both pages with `lastmod`; the 404 is `noindex`.
- The manifest uses the KubeTEE stage color (`#27282a`) and the brand icons. A minimal service worker keeps the app installable without caching app data; the footer exposes “Install app” only when the browser reports installability.

## Brand assets

`public/brand/` contains the official logos and icons plus the brand guidelines PDF. Usage rules: `public/brand/README.md`. The site uses `/brand/kubetee-logo.svg`; `public/logo.png` is the on-chain Bittensor subnet identity image served at `https://kubetee.ai/logo.png`.
