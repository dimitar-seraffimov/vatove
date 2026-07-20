FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:${PATH}"

RUN addgroup --system --gid 10001 vatove \
    && adduser --system --uid 10001 --ingroup vatove --home /nonexistent vatove

WORKDIR /app

COPY services/worker ./services/worker
RUN python -m venv /app/.venv \
    && /app/.venv/bin/pip install --no-cache-dir --disable-pip-version-check -r services/worker/requirements.lock \
    && /app/.venv/bin/pip install --no-cache-dir --disable-pip-version-check --no-deps ./services/worker \
    && chown -R vatove:vatove /app

USER vatove

CMD ["vatove-worker"]
