FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=10000 \
    IZGE_SQLITE_PATH=/data/izge.db \
    IZGE_STORAGE_ROOT=/data/storage \
    IZGE_PASTED_TEXT_ROOT=/data/pasted \
    IZGE_BOOTSTRAP_ADMIN_CREDENTIALS_PATH=/data/bootstrap_admin_credentials.json

RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext-base nginx supervisor \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default

WORKDIR /app/backend
COPY backend/pyproject.toml backend/README.md ./
COPY backend/app ./app
COPY backend/migrations ./migrations
COPY backend/manual_eval ./manual_eval
COPY backend/alembic.ini ./alembic.ini
RUN pip install --upgrade pip && pip install .

COPY --from=frontend-build /build/frontend/dist /usr/share/nginx/html
COPY deploy/app/nginx.conf.template /etc/nginx/templates/izge.conf.template
COPY deploy/app/supervisord.conf /etc/supervisor/conf.d/izge.conf
COPY deploy/app/entrypoint.sh /usr/local/bin/izge-entrypoint
RUN chmod 755 /usr/local/bin/izge-entrypoint \
    && mkdir -p /data/storage /data/pasted /run/nginx \
    && chown -R www-data:www-data /data /app/backend

EXPOSE 10000

ENTRYPOINT ["izge-entrypoint"]

