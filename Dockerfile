# Use official Node.js 20 (latest LTS as of early 2025)
FROM node:20-alpine

# No need to install yarn globally, it's already installed in the base image
# RUN npm install -g yarn --force

# Set working directory
WORKDIR /app

COPY package*.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy application code
COPY . .

# Expose the port (typically 8080 for Node.js apps on DO App Platform)
EXPOSE 8080

# Start the application
CMD ["yarn", "start"]