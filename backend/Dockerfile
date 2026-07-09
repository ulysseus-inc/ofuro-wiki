FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine

RUN apk add --no-cache postgresql17-client

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3010
# #34: マイグレーション(DDL)は MIGRATE_DATABASE_URL があればそれで実行する。
# 最小権限化で runtime(DATABASE_URL) を非superuserロールに切替えた際、
# migrate deploy だけは DDL 権限を持つロール(superuser 等)で実行するため。
# 未設定なら DATABASE_URL にフォールバック（後方互換）。
# exec で node を PID1 に置換し、SIGTERM を受けて graceful shutdown できるようにする。
CMD ["sh", "-c", "DATABASE_URL=\"${MIGRATE_DATABASE_URL:-$DATABASE_URL}\" npx prisma migrate deploy && exec node dist/src/main.js"]
