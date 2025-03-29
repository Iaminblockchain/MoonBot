import { retrieveEnvVariable } from "./config";
import * as db from "./db";
import * as dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import * as script from "./script";
import express from 'express';
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

import * as bot from "./bot";

const app = express();
const port = Number(process.env.PORT) || 8080;

// Only expose a basic health check endpoint
app.get('/health', (_, res) => {
  res.status(200).send('OK');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Health check server listening on port ${port}`);
});

const main = async () => {
  await db.connect();
  // await script.script();
  bot.init();
};

main();
