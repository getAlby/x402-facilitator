FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "src/index.ts"]
