# Dockerfile
FROM node:20-bookworm-slim

# Set environment to production
ENV NODE_ENV=production

# Install dependencies for native modules (e.g. better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create app directory with proper ownership
RUN mkdir -p /app && chown -R root:root /app
WORKDIR /app

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs astro

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and entrypoint script
COPY . .

# Set correct permissions and ownership
RUN chmod +x /app/docker-entrypoint.sh && \
    chown -R astro:nodejs .

# Switch to non-root user
USER astro

# Expose the Astro default port
EXPOSE 4321

# Start the server using the entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]