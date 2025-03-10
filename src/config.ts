import { Connection } from "@solana/web3.js";

export const TELEGRAM_BOT_TOKEN = '8095725117:AAExjnEzaBO_f0TnSa4-kckYHoUnKQap0zM';
export const RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";
export const MONGO_URI = "mongodb://127.0.0.1:27017/MoonBot";
export const SOLANA_RPC_ENDPOINT = "https://mainnet.helius-rpc.com?api-key=c0ba78df-138e-4f6c-af1b-cf8c78c908a0"
export const SOLANA_WSS_ENDPOINT = 'wss://black-maximum-model.solana-mainnet.quiknode.pro/b8ff26d679bae55edebf4d7739e44f48456055a5'; // replace your wss
export const SOLANA_CONNECTION = new Connection(SOLANA_RPC_ENDPOINT, { wsEndpoint: SOLANA_WSS_ENDPOINT, commitment: "confirmed"});
export const SLIPPAGE = 5;
export const JITO_TIP = 1500000  // not using right now
export const TX_FEE = 1000000;   // not using right now
export const ACCOUNT_FEE = 2000000;   // not using right now
