FROM node:24-alpine
WORKDIR /app
COPY package.json server.js rules.js store.js ./
COPY public ./public
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
