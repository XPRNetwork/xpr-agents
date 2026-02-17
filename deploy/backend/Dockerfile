FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY dist/ ./dist/

RUN mkdir -p /app/data

ENV PORT=3500
EXPOSE 3500

CMD ["node", "dist/index.js"]
