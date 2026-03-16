FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/ packages/
RUN npm ci
RUN npm run build
RUN npm run build:ui

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV REVAHUB_DIR=/data/revahub

COPY package.json package-lock.json ./
COPY packages/ packages/
RUN npm ci --omit=dev

COPY --from=builder /app/packages/revahub/dist packages/revahub/dist
COPY --from=builder /app/packages/revahub-module-database/dist packages/revahub-module-database/dist
COPY --from=builder /app/packages/revahub-module-logger/dist packages/revahub-module-logger/dist
COPY --from=builder /app/packages/revahub-task-cleanup-logs/dist packages/revahub-task-cleanup-logs/dist

EXPOSE 3000
VOLUME /data/revahub

CMD ["node", "packages/revahub/dist/cli.js"]
