FROM docker.io/library/node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
WORKDIR /app
RUN mkdir /state && chown node:node /state && chmod 700 /state
COPY checkers-admin.html checkers-room.mjs admin-panel.html server.mjs room-store.mjs gomoku-ai.mjs ./
COPY public/ ./public/
COPY deploy/register-webhook.mjs ./deploy/
RUN chmod -R a+rX /app
USER node
ENV HOST=0.0.0.0 PORT=8080 GOMOKU_STATE_FILE=/state/gomoku.json
CMD ["node", "server.mjs"]
