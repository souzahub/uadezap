# Dockerfile
FROM node:22.16.0-alpine

WORKDIR /app

COPY .node-version .node-version

COPY package*.json ./

RUN npm install
RUN apk add --no-cache ffmpeg

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
