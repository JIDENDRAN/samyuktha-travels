# Use a Lightweight Node image
FROM node:22-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 10000

# Start the server
CMD ["node", "realtime/server.js"]
