# Vatove

Vatove is a local-first geospatial biometric PWA. Its first vertical slice imports a
single athlete's Intervals.icu activities through a REST/Kafka/Python/PostGIS pipeline
and displays heart-rate zones on a synchronized MapLibre route and D3 elevation chart.

## Prerequisites

- Node.js 24 and npm 11
- Python 3.12 managed by `uv`
- Podman 5 with a running Podman machine
- A personal Intervals.icu API key

## Local setup

```powershell
Copy-Item .env.example .env
uv venv --python 3.12 .venv
uv sync --all-packages --dev --locked
npm ci
podman machine start
podman compose up --build
```

Open <http://localhost:8080>. All exposed ports bind to localhost. Never commit `.env`.
The worker requires a personal key from the Intervals.icu developer settings; sync requests remain
queued if `INTERVALS_API_KEY` is blank.

If image pulls fail with `x509: certificate signed by unknown authority` on a managed network,
install the organization's root CA in the Podman machine trust store and restart the machine. Do
not work around the error by marking public registries insecure.

## Checks

```powershell
npm run typecheck
npm test
uv run ruff check services/worker
uv run pytest
```
