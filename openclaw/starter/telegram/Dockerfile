FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src/ src/
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist/ dist/
RUN mkdir -p /data
EXPOSE 3002
CMD ["node", "dist/index.js"]
