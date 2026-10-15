# Immagine unica per prova locale e produzione.
FROM node:25-alpine

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
# File leggibili ma non modificabili dall'utente che esegue l'app.
RUN chmod -R a+rX,go-w /app

# Cartella dati (database e chiave segreta dei codici), scrivibile solo dall'utente "node".
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
VOLUME /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
