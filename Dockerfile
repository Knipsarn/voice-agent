FROM node:20-alpine

# Mirror the repo structure so __dirname-relative paths in tenantLoader resolve correctly:
#   /app/apps/voice-bridge/../../configs/tenants  ->  /app/configs/tenants
WORKDIR /app/apps/voice-bridge

# Install production dependencies
COPY apps/voice-bridge/package*.json ./
RUN npm install --omit=dev

# Copy bridge source
COPY apps/voice-bridge/index.js ./
COPY apps/voice-bridge/tenantLoader.js ./
COPY apps/voice-bridge/providers ./providers

# Bake tenant configs and prompt assets into image for Phase 1.
# Phase 2: replace with Firestore/Cloud Storage lookup and remove these COPYs.
COPY configs/tenants /app/configs/tenants
COPY configs/prompt-assets /app/configs/prompt-assets

EXPOSE 8080
CMD ["node", "index.js"]
