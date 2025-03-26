import { Connection } from "@solana/web3.js";

//export const TELEGRAM_BOT_TOKEN = '8095725117:AAExjnEzaBO_f0TnSa4-kckYHoUnKQap0zM';
export const TELEGRAM_BOT_TOKEN = '7500883190:AAG03x0kBlJih-2uvhTUnrWuA7bUPQAd4RU';
export const RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";
export const MONGO_URI = "mongodb://mongo:27017/MoonBot";
export const SOLANA_RPC_ENDPOINT = "https://solana-api.instantnodes.io/token-MsxS6DYFqjhhkiEYlngXUR93cVb4OFYz"
export const SOLANA_WSS_ENDPOINT = 'wss://solana-api.instantnodes.io/token-MsxS6DYFqjhhkiEYlngXUR93cVb4OFYz'; // replace your wss
export const SOLANA_CONNECTION = new Connection(SOLANA_RPC_ENDPOINT, { wsEndpoint: SOLANA_WSS_ENDPOINT, commitment: "confirmed"});
export const SLIPPAGE = 5;
export const JITO_TIP =1000000  // not using right now
export const TX_FEE = 1000000;   // not using right now
export const ACCOUNT_FEE = 2000000;   // not using right now
export const SERVER_PORT = 3000;