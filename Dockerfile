FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BIBLIO_HOST=0.0.0.0 \
    PORT=8000 \
    BIBLIO_DB_PATH=/data/biblio.sqlite3

WORKDIR /app

RUN useradd --system --uid 10001 --create-home app \
    && mkdir /data \
    && chown app:app /data

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=app:app server.py index.html script.js styles.css ./

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import os; from urllib.request import urlopen; urlopen('http://127.0.0.1:' + os.getenv('PORT', '8000') + '/api/me', timeout=2).read()"]

CMD ["python", "server.py"]
