FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/main.ts"]
