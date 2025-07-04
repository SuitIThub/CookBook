# Dockerfile
FROM node:22.1.0-bullseye

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Init & migrate DB, then build
RUN npm run db:init && npm run db:migrate && npm run build

# Start the server
CMD ["npm", "run", "start"]