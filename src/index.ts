import { retrieveEnvVariable } from "./config";
import * as db from "./db";
import * as dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import { scrape } from "./scraper/scraper";
import * as bot from "./bot";
import { logger } from "./util";
import { setupServer } from "./server";
import { getTgClient } from "./scraper/scraper";
import { joinChannelsDB } from "./scraper/manageGroups";
import { Chat } from "./models/chatModel";
import { getCSVRecords, seedPredefinedChannels } from "./scraper/seedPredefinedChannels";
import { botInstance } from "./bot";
import mongoose from "mongoose";
import { TelegramClient } from "telegram";

dotenv.config();

export const ALLOWED_ORIGIN = retrieveEnvVariable("allowed_origin");
export const SETUP_BOT = retrieveEnvVariable("setup_bot") === "true";
export const TELEGRAM_BOT_TOKEN = retrieveEnvVariable("telegram_bot_token");
export const MONGO_URI = retrieveEnvVariable("mongo_url");
export const SOLANA_RPC_ENDPOINT = retrieveEnvVariable("solana_rpc_endpoint");
export const SOLANA_WSS_ENDPOINT = retrieveEnvVariable("solana_wss_endpoint");
export const JITO_TIP = Number(retrieveEnvVariable("jito_tip"));
export const TELEGRAM_API_ID = Number(retrieveEnvVariable("telegram_api_id"));
export const TELEGRAM_API_HASH = retrieveEnvVariable("telegram_api_hash");
export const TELEGRAM_STRING_SESSION = retrieveEnvVariable("telegram_string_session");
export const SOLANA_CONNECTION = new Connection(SOLANA_RPC_ENDPOINT, {
  wsEndpoint: SOLANA_WSS_ENDPOINT,
  commitment: "confirmed",
});

export let client: TelegramClient | undefined;

const gracefulShutdown = async () => {
  logger.info('Starting graceful shutdown...');

  try {
    // Close Telegram client if it exists
    if (client) {
      await client.disconnect();
      logger.info('Telegram client disconnected');
    }

    // Stop Telegram bot if it exists
    if (botInstance) {
      await botInstance.stopPolling();
      logger.info('Telegram bot polling stopped');
    }

    // Close MongoDB connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
    }

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await gracefulShutdown();
});

const initializeServices = async () => {
  try {
    logger.info('Connecting to mongo database...');
    await db.connect();

    // login
    logger.info('Connecting to telegram client...');
    client = await getTgClient();

    return true;
  } catch (error) {
    console.error('Service initialization failed:', error);
    return false;
  }
};

const runServices = async () => {
  try {
    if (!client) {
      logger.error('Telegram client is not initialized');
      return false;
    }

    //check DB and csv, ensure we seed the chats from csv file
    const dbChats = await Chat.find({}, 'chat_id');
    logger.info('number of chats in the DB ', { dbChats: dbChats.length });

    const csvRecords = getCSVRecords();
    logger.info('number of records in CSV: ', { csvRecords: csvRecords.length });

    if (dbChats.length === 0 || dbChats.length !== csvRecords.length) {
      logger.info("seeding predefined channels from CSV...");
      await seedPredefinedChannels();
    }

    // check number of chats we're in
    const dialogs = await client.getDialogs({});
    logger.info('number of chats TG client is in: ', { dialogs: dialogs.length });
    if (dialogs.length == 0) {
      logger.info("haven't joined chats");
      await joinChannelsDB(client);
    }

    logger.info('Initializing scrape script...');
    await scrape(client);

    if (SETUP_BOT) {
      logger.info('Starting TG bot...');
      bot.init();
    } else {
      logger.info('TG bot setup skipped (SETUP_BOT=false)');
    }

    return true;
  } catch (error) {
    console.error('Service initialization failed:', error);
    return false;
  }
};

const main = async () => {
  const port = Number(process.env.PORT) || 8080;

  const servicesInitialized = await initializeServices();
  if (!servicesInitialized) {
    console.error('Failed to initialize required services. Exiting...');
    process.exit(1);
  }

  try {
    console.info("Starting server...")
    await setupServer(port);
    logger.info('✅ Server successfully started!');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  const servicesRunning = await runServices();
  if (!servicesRunning) {
    console.error('Failed to run services. Exiting...');
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});