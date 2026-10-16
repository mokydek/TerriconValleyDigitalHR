# JanaMen — образ веб-приложения для локального стека (docker compose up).
# В облачной версии ту же роль выполняют Vercel (SPA + /api/ai-jana) и Supabase.

# 1. Сборка SPA и серверной функции AI Jana
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# За корпоративным прокси с собственным сертификатом: передайте CA как build-secret `npm_ca`
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
 && npx esbuild api/ai-jana.ts --bundle --platform=node --format=esm --target=node22 \
      --outfile=build-server/ai-jana.mjs \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

# 2. Рантайм: Node-шлюз без лишних зависимостей
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-server/ai-jana.mjs ./server/ai-jana.mjs
COPY docker/server.mjs ./server/server.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server/server.mjs"]
