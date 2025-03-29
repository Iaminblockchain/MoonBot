import { retrieveEnvVariable } from "./config";
import * as db from "./db";
import * as dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import * as script from "./script";
import express from 'express';
import * as bot from "./bot";

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

const setupServer = (port: number) => {
  const app = express();
  
  app.get('/health', (_, res) => {
    res.status(200).send('OK');
  });
  
  return new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`Health check server listening on port ${port}`);
      resolve();
    });
  });
};

const initializeServices = async () => {
  try {
    console.log('Connecting to database...');
    await db.connect();

    console.log('Initializing script...');
    await script.script();

    console.log('Starting bot...');
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
    console.log('Application successfully started!');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
