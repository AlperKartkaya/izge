FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN addgroup --system izge && adduser --system --ingroup izge izge

COPY pyproject.toml README.md ./
COPY app ./app
COPY manual_eval ./manual_eval

RUN pip install --upgrade pip && pip install .

RUN mkdir -p /data/storage /data/pasted && chown -R izge:izge /data /app

ENV IZGE_SQLITE_PATH=/data/izge.db \
    IZGE_STORAGE_ROOT=/data/storage \
    IZGE_PASTED_TEXT_ROOT=/data/pasted \
    IZGE_BOOTSTRAP_ADMIN_CREDENTIALS_PATH=/data/bootstrap_admin_credentials.json

USER izge

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
