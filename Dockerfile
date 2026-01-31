FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY dashboard.js ./
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "server.js"]
