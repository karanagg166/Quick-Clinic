FROM ghcr.io/astral-sh/uv:0.13.7 AS uv
FROM python:3.13-slim AS base
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev
COPY app ./app
COPY scripts ./scripts
RUN useradd --uid 10001 --create-home clinic && mkdir -p /app/data/medical-documents && chown -R clinic:clinic /app
USER clinic
EXPOSE 4000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-4000} --no-proxy-headers"]
FROM base AS development
USER root
RUN uv sync --locked
USER clinic
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4000", "--reload", "--no-proxy-headers"]
FROM base AS production
