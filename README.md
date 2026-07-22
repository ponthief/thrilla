# Silent Payments App

Standalone Vue 3 SPA for the `silnt` LNbits extension. Hosted independently of LNbits.

## Setup

```bash
cp .env.example .env
# Edit .env — set VITE_LNBITS_URL for local dev only (see below)

npm install
npm run dev      # development
npm run build    # production → dist/
```

## Environment

| Variable | Purpose |
|---|---|
| `VITE_LNBITS_URL` | LNbits base URL. **Leave empty in production** if using Caddy proxy (recommended). Set to `https://lnbits.example.net` for local dev. |
| `VITE_SILNT_PREFIX` | Extension mount path. Default: `/siLNt` |

## Production Caddy Setup (recommended)

Host the built `dist/` on `example.net` and proxy `/api/*` and `/siLNt/*`
to your LNbits instance. This eliminates all CORS issues entirely.

```caddy
example.net {
    # Serve the Vue SPA
    root * /var/www/thrilla
    try_files {path} /index.html

    # Proxy LNbits core API (auth, wallets)
    handle /api/* {
        reverse_proxy lnbits.example.net {
            header_up Host lnbits.example.net
        }
    }

    # Proxy silnt extension API
    handle /siLNt/* {
        reverse_proxy lnbits.example.net {
            header_up Host lnbits.example.net
        }
    }

    file_server
}
```

With this setup, set `VITE_LNBITS_URL=` (empty) in your `.env` before building,
so all API calls go to the same origin.

## Deploy

```bash
npm run build
rsync -av dist/ user@server:/var/www/thrilla/
```
