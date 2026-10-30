FROM node:20-bookworm-slim

# A CJK font so the "AI生成" watermark renders on Linux.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-wqy-microhei fontconfig ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts

ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data LIBRARY_DIR=/library
RUN mkdir -p /data /library && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
