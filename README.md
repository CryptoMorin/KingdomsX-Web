# KingdomsX Web

[KingdomsX](https://github.com/CryptoMorin/KingdomsX) is a Minecraft plugin similar to Factions, with more advanced core features and additional mechanics such as turrets, structures, and invasions.

This repository contains the public [website](https://kingdomsx.com) for the project. It is built with Astro and deployed on Cloudflare.

## Stack
- **Astro** - static site framework
- **Cloudflare Workers** - request routing, API handlers, scheduled cron
- **Cloudflare D1** - SQLite database for server listings
- **TypeScript** - worker code under `worker/`

## Requirements
- Node.js 24
- npm

## Project Structure
- `src/pages/` - Astro page entrypoints
- `src/components/` - reusable Astro components
- `src/assets/` - bundled styles, scripts, and imported media
- `src/data/` - content/data modules used by the site
- `public/` - files copied directly to the site root
- `worker/` - Cloudflare Worker source and local development assets
- `wrangler.jsonc` - production Cloudflare configuration
- `wrangler.local.jsonc` - local preview configuration

## Development
Contributions are appreciated and always welcome through [pull requests](https://github.com/CryptoMorin/KingdomsX-Web/pulls).

### Setup
Clone the repository:

```bash
git clone https://github.com/CryptoMorin/KingdomsX-Web.git
cd KingdomsX-Web
```

Install dependencies:

```bash
npm ci
```

Copy the example local environment file:

```bash
cp .dev.vars.example .dev.vars
```

The checked-in example values are enough for the local Worker preview. Real credentials are only needed for OAuth-specific testing.

### Workflows
After setup, use one of these development workflows depending on what you're working on:

#### 1. Astro dev server
Use this for quick frontend work. It skips the Worker and serves pages directly via Astro's dev server.

```bash
npm run dev
```

#### 2. Full Worker preview
Use this when working on routing, API handlers, D1 queries, or server listings. It builds the Astro site and serves it through the local Cloudflare Worker on port `8787`, backed by local D1 data and secrets from `.dev.vars`.

Run the local setup before the first preview, after pulling or adding D1 migrations, or whenever you need to refresh local preview data:

```bash
npm run worker:setup:local
```

Then start the preview:

```bash
npm run preview
```

## Checks
Please run these before opening a pull request.

Run the Cloudflare Worker and D1 test suite after changing Worker behavior, API handlers, migrations, or server-directory logic:

```bash
npm run worker:test
```

Type-check Worker code after changing anything under `worker/`:

```bash
npm run worker:typecheck
```

Regenerate Worker type bindings after changing bindings or Wrangler config:

```bash
npm run worker:types:check
```

Run a deploy dry-run after changing Worker routing, bindings, or Cloudflare configuration:

```bash
npm run worker:deploy:check
```

Run the production build before all pull requests:

```bash
npm run build
```
