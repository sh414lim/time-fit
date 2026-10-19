FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
