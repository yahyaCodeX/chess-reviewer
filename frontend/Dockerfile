# Stage 1: build the React app
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Leave empty to call the API on the same origin (Caddy proxies /api and /ws)
ARG VITE_API_URL=
ARG VITE_WS_URL=
RUN npm run build

# Stage 2: Caddy serves the static files and reverse-proxies the backend,
# with automatic HTTPS from Let's Encrypt
FROM caddy:2.8-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
