FROM node:22-alpine

# better-sqlite3 needs build tools to compile its native module on install
# su-exec lets the entrypoint drop from root to PUID/PGID (unraid convention)
RUN apk add --no-cache python3 make g++ su-exec

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV LIBRARY_PATH=/library
ENV CONFIG_DIR=/config
ENV PORT=8420
ENV PUID=99
ENV PGID=100

VOLUME ["/library", "/config"]
EXPOSE 8420

ENTRYPOINT ["./entrypoint.sh"]
