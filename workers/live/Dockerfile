# The poller's image: the repository's code and production dependencies, running server/ingest.ts.
FROM node:24-bookworm-slim
# DuckDB's HTTPS reads use the system's certificates.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "server/ingest.ts"]
