# Multi-stage Dockerfile для легковесного TypeScript Fastify + SQLite бекенда

# 1. Этап сборки (Builder)
FROM node:22-slim AS builder

WORKDIR /app

# Устанавливаем инструменты для компиляции нативного better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY tsconfig.json drizzle.config.ts ./
COPY src/ ./src/

RUN npm run build

# 2. Этап выполнения (Production Runner)
FROM node:22-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db ./dist/db

# Создаем папки для монтирования томов базы данных и загрузок
RUN mkdir -p /app/data /app/uploads

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/anatomyfit.sqlite
ENV UPLOAD_DIR=/app/uploads

EXPOSE 3001

CMD ["node", "dist/index.js"]
