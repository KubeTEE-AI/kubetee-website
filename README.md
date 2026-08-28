# kubetee-website

The public KubeTEE website — [kubetee.ai](https://kubetee.ai). A simple, high-level front door for the project; depth lives in [kubetee-subnet](https://github.com/KubeTEE-AI/kubetee-subnet).

## Stack

- [Astro](https://astro.build) 5 — static output, zero client-side JavaScript
- No UI framework, no CSS framework — scoped styles in the components
- Brand assets in `public/brand/` (logos, icons, guidelines)

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:4321
```

## Build

```bash
pnpm build      # static output in dist/
pnpm preview
```

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) builds on every push to `main` and deploys to GitHub Pages. The custom domain `kubetee.ai` is served from a `CNAME` file written into the build output; DNS is DNS-only (grey cloud) in Cloudflare.

The on-chain Bittensor subnet identity `logo_url` points at `https://kubetee.ai/logo.png` — served from `public/logo.png` (the brand icon PNG).

## Brand assets

`public/brand/` contains the official logos and icons (SVG, PNG, PDF, high-res JPG) plus the brand guidelines PDF. Usage do's and don'ts: `public/brand/README.md`.
