FROM node:24.20.0-alpine
WORKDIR /app
COPY --chown=node:node apps/web/index.html apps/web/style.css apps/web/app.js apps/web/server.mjs ./apps/web/
USER node
ENV WEB_HOST=0.0.0.0 WEB_PORT=4173
EXPOSE 4173
CMD ["node", "apps/web/server.mjs"]
