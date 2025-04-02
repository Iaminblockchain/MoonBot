import { retrieveEnvVariable } from "./config";
import * as db from "./db";
import * as dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import { scrape } from "./scraper/scrapescript";
import * as bot from "./bot";
import { logger } from "./util";
import { setupServer } from "./server";

dotenv.config();

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

const initializeServices = async () => {
  try {
    logger.info('Connecting to mongo database...');
    await db.connect();

    logger.info('Initializing scrape script...');
    await scrape();

    logger.info('Starting TG bot...');
    bot.init();

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
    await setupServer(port);
    logger.info('Application successfully started!');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});