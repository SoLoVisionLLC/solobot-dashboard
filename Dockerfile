FROM node:20-alpine
WORKDIR /app

# Copy application files
COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY dashboard.js ./
COPY gateway-client.js ./
COPY docs-hub-memory-files.js ./
COPY solobot-avatar.png ./
COPY favicon.svg ./
COPY avatars ./avatars/

# Create data directory (will be mounted as volume in production)
RUN mkdir -p data

# Copy default state ONLY if using without volume (for local dev)
# In Coolify, the volume mount will override this directory
COPY data/default-state.json ./data/default-state.json

EXPOSE 3000
CMD ["node", "server.js"]
