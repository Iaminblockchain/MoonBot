# Use official Node.js 20 (latest LTS as of early 2025)
FROM node:20-alpine

# Set working directory
WORKDIR /app

COPY package.json .

# Install dependencies
RUN npm install
# For yarn: RUN yarn install

# Copy application code
COPY . .

# Start the application
CMD ["npm", "start"]
# For yarn: CMD ["yarn", "start"]