# Dockerfile
FROM node:20-bullseye-slim

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

# Copy source
COPY . .

# Set correct ownership
RUN chown -R astro:nodejs .

# Switch to non-root user
USER astro

# Init & migrate DB, then build
RUN npm run db:init && npm run db:migrate && npm run build

# Expose the Astro default port
EXPOSE 4321

# Start the server
CMD ["npm", "run", "start"]