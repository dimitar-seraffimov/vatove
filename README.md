# vatove

vatove is a fun mostly vibe-coded project.
Decided to try how much agents have improved in building complex applications. I want to improve
how outdoor activities are displayed for athletes to analyse, started the project with 
my personal Intervals.icu activities as initial data. 

The goal is to have a global map with all activities (starting with the past 60 days) 
displayed on the map for analysis. Each activity can be selected and analysed with all 
training data provided from the Intervals.icu API.

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

## Updating an existing Podman stack

Build every changed application image, run the migration explicitly, and recreate the long-running
containers so that they cannot continue using an older image:

```sh
git pull --ff-only
podman-compose build migrate api worker nginx
podman-compose run --rm migrate alembic -c services/worker/alembic.ini upgrade head
podman-compose up -d --force-recreate api worker nginx
```

If the installed `podman-compose` does not support `--force-recreate`, use a full container
recreation. This preserves the named PostGIS and Kafka volumes; do not add `-v`:

```sh
podman-compose down
podman-compose up -d --build
```

Verify that the database, API, worker, and migration image all use the updated revision without printing credentials:

```sh
podman-compose exec postgis sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version"'
podman-compose exec api grep -q 'subtractCalendarDays(newest, 59)' services/api/dist/dates.js
curl --fail --silent http://127.0.0.1:8080/api/v1/health/ready
podman-compose ps
```

The revision query must print `20260720_0002`, the `grep` command must exit successfully, and the
readiness endpoint must return `{"status":"ok"}`. Trigger a new sync after deployment; a failed
event that was already sent to the dead-letter topic is not retried automatically.

## Checks

```powershell
npm run typecheck
npm test
uv run ruff check services/worker
uv run pytest
```
