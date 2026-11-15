# Stage 1: build the React frontend
FROM node:22-slim AS build
WORKDIR /src/app
COPY app/package*.json ./
RUN npm ci
COPY app/ ./
RUN npm run build

# Stage 2: server (serves the API, Socket.io and the built frontend)
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/ambulance.db
WORKDIR /srv/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=build /src/app/dist /srv/app/dist

# SQLite lives on a volume mounted at /data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "index.js"]
