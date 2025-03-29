# Use official Node.js 20 (latest LTS as of early 2025)
FROM node:20-alpine

# Set working directory
WORKDIR /app

COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Expose the port (typically 8080 for Node.js apps on DO App Platform)
EXPOSE 8080

# Start the application
CMD ["npm", "start"]