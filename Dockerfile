# ============================================================
# Stage 1: Build frontend (ofuro-wiki web app)
# ============================================================
FROM node:22-alpine AS frontend-builder

RUN corepack enable && corepack prepare yarn@4.12.0 --activate
RUN apk add --no-cache python3 make g++ git

WORKDIR /frontend

# Copy entire frontend directory
COPY frontend/ .

# Initialize a git repo (husky postinstall needs it)
RUN git init

# Install dependencies
# HUSKY=0 prevents husky from installing git hooks
ENV HUSKY=0
RUN yarn install --inline-builds

# PUBLIC_PATH=/ ensures assets are served from our own server
ENV BUILD_TYPE=stable
ENV PUBLIC_PATH=/

# SKIP_MOBILE=true to skip mobile build (saves ~70min in dev)
ARG SKIP_MOBILE=false

# Build the web application (needs extra memory for TerserPlugin)
RUN NODE_OPTIONS=--max-old-space-size=4096 NODE_ENV=production yarn ofuro build -p web

# Build the mobile application (optional)
RUN if [ "$SKIP_MOBILE" = "false" ]; then \
      NODE_OPTIONS=--max-old-space-size=4096 NODE_ENV=production yarn ofuro build -p mobile; \
    else \
      mkdir -p /frontend/packages/frontend/apps/mobile/dist && \
      echo "mobile build skipped" > /frontend/packages/frontend/apps/mobile/dist/index.html; \
    fi

# ============================================================
# Stage 2: Build backend (NestJS)
# ============================================================
FROM node:22-alpine AS backend-builder

WORKDIR /backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ .
RUN npx prisma generate
RUN npm run build

# ============================================================
# Stage 3: Production runtime
# ============================================================
FROM node:22-alpine

RUN apk add --no-cache postgresql17-client

# #8: App version — passed via --build-arg VERSION=$(git describe --tags)
ARG VERSION=0.1.0
ENV APP_VERSION=${VERSION}

WORKDIR /app

# Copy backend
COPY --from=backend-builder /backend/dist ./dist
COPY --from=backend-builder /backend/generated ./generated
COPY --from=backend-builder /backend/node_modules ./node_modules
COPY --from=backend-builder /backend/package.json ./
COPY --from=backend-builder /backend/prisma ./prisma
COPY --from=backend-builder /backend/prisma.config.ts ./
COPY --from=backend-builder /backend/tsconfig.json ./

# Copy frontend dist as static files
# The backend's ServeStaticModule serves from /app/public/
COPY --from=frontend-builder /frontend/packages/frontend/apps/web/dist ./public
# Mobile dist — MobileRedirectMiddleware serves HTML, ServeStaticModule serves assets
COPY --from=frontend-builder /frontend/packages/frontend/apps/mobile/dist ./public-mobile

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3010/api/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
