# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini openssl wget ca-certificates iputils-ping fping net-tools python3-impacket impacket-scripts \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY node_modules ./node_modules
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/web/dist ./apps/server/web-dist
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN mkdir -p /app/uploads
ENV NODE_ENV=production
WORKDIR /app/apps/server
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
