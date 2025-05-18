# Moonbot Server

A Telegram bot server built with Node.js, TypeScript, and MongoDB for managing token launches and community interactions on the Solana blockchain.

## Features

- Telegram bot integration for community management
- MongoDB database for data persistence
- TypeScript for type safety and better development experience
- Automated testing with Jest
- Code quality tools (ESLint, Prettier)

## Prerequisites

- Node.js (v16 or higher)
- MongoDB
- Telegram Bot Token
- Solana wallet and configuration

## Setup

1. Clone the repository:

```bash
git clone [repository-url]
cd moonbot-server
```

2. Install dependencies:

```bash
npm install
# or
yarn install
```

3. Configure environment variables:

```bash
cp .env.example .env
```

Edit `.env` with your configuration values.

4. Start MongoDB:

```bash
mongod
```

5. Start the server:

```bash
npm run start
# or
yarn start
```

## Development

- `npm run start` - Start development server
- `npm run build` - Build TypeScript files
- `npm run test` - Run tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Database Management

- Connect to MongoDB:

```bash
mongosh mongodb://localhost:27017/moonbot
```

- Seed channels:

```bash
npm run seedchannels
```

## Deployment

## Scripts

- `login-telegram` - Login to Telegram
- `dropchats` - Drop chat data
- `showdb` - Display database contents
- `joinchannel` - Join a channel by name
- `export` - Export data
- `joinchatsdb` - Join chats from database
