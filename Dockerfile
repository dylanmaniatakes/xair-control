FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data
LABEL org.opencontainers.image.title="X AIR Control" \
      org.opencontainers.image.source="https://github.com/DylanManiatakes/xair-control" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock && useradd --uid 10001 --create-home xair && mkdir /data && chown xair:xair /data
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY app ./app
USER xair
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
