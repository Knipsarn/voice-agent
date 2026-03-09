FROM node:20-alpine

# Mirror the repo structure so __dirname-relative paths in tenantLoader resolve correctly:
#   /app/apps/voice-bridge/../../config/tenants  ->  /app/config/tenants
WORKDIR /app/apps/voice-bridge

# Install production dependencies
COPY apps/voice-bridge/package*.json ./
RUN npm install --omit=dev

# Copy bridge source
COPY apps/voice-bridge/index.js ./
COPY apps/voice-bridge/tenantLoader.js ./

# Bake tenant configs into image for Phase 1.
# Phase 2: replace with Firestore lookup and remove this COPY.
COPY config/tenants /app/config/tenants

EXPOSE 8080
CMD ["node", "index.js"]
