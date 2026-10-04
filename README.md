# KingdomsX Web

[KingdomsX](https://github.com/CryptoMorin/KingdomsX) is a Minecraft plugin similar to Factions, with more advanced core features and additional mechanics such as turrets, structures, and invasions.

This repository contains the public [website](https://kingdomsx.com) for the project. It is built with Astro and deployed on Cloudflare.

## Stack

- **Astro** - static site framework
- **Cloudflare Workers** - website, server listings and config editor deployments
- **Cloudflare D1** - SQLite database for server listings
- **TypeScript** - Worker code under `worker/`

## Requirements

- Node.js 24
- npm

## Project Structure

- `src/pages/` - Astro page entrypoints
- `src/components/` - reusable Astro components
- `src/assets/` - bundled styles, scripts and imported media
- `src/data/` - content modules and generated editor catalogs
- `public/` - files copied directly to the site root
- `worker/` - main website Worker, shared tests, migrations and local development assets
- `worker/server-directory/` - server listings Worker, APIs, scheduled work and D1 logic
- `worker/config-editor/` - config editor Worker
- `scripts/config-editor/` - editor catalog generation and validation
- `wrangler*.jsonc` - production, local and test configuration for the three Workers

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

```sh
node -e "require('node:fs').copyFileSync('.dev.vars.example', '.dev.vars')"
```

Editor browser tests also require Playwright's Chromium build:

```bash
npx playwright install chromium
```

The checked-in example values are enough for local Worker previews. Real credentials are only needed for OAuth-specific testing.

### Running locally

#### 1. Astro dev server

Use this for quick frontend work. It skips the Worker runtime and serves pages directly through Astro.

```bash
npm run dev
```

#### 2. Individual Worker previews

Prepare the local server listings database before the first preview, after adding migrations, or whenever the sample data needs to be reset:

```bash
npm run worker:setup:local
```

Use the server-directory preview when working on listings, APIs, D1 queries or scheduled refreshes:

```bash
npm run preview
```

Use the editor preview when working on the standalone config editor:

```bash
npm run editor:preview
```

#### 3. Complete local website

After preparing the local database as above, build and start all three Workers together:

```bash
npm run preview:all
```

The combined preview is maintained for Unix-like environments (e.g. Linux or WSL). On native Windows use the individual previews as mentioned above.

## Checks

Please run the checks relevant to your changes before opening a pull request.

For website and server listings Worker changes:

```bash
npm run worker:test
npm run worker:types:check
npm run worker:typecheck
npm run build
npm run server-directory:build
npm run worker:deploy:check
```

For editor changes:

```bash
npm run editor:snapshots:check
npm run editor:test
npm run editor:browser:test
npm run editor:worker:test
npm run editor:worker:types:check
npm run editor:worker:typecheck
npm run editor:build:production
npm run editor:deploy:dry-run
```
