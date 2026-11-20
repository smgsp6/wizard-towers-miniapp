FROM docker.io/library/node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app
RUN mkdir /state && chown node:node /state && chmod 700 /state
COPY estate-admin.html estate-room.mjs checkers-admin.html checkers-room.mjs admin-panel.html server.mjs room-store.mjs gomoku-ai.mjs ./
COPY public/ ./public/
COPY deploy/register-webhook.mjs deploy/cloudflare-route.mjs ./deploy/
RUN chmod -R a+rX /app
USER node
ENV HOST=0.0.0.0 PORT=8080 GOMOKU_STATE_FILE=/state/gomoku.json
CMD ["node", "server.mjs"]
