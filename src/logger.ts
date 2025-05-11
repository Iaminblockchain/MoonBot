import winston from "winston";
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";
import { retrieveEnvVariable } from "./config";
import { 
    TELEGRAM_API_ID, 
    TELEGRAM_API_HASH,
    TELEGRAM_BOT_TOKEN,
    MONGO_URI,
    SOLANA_RPC_ENDPOINT,
    SOLANA_WSS_ENDPOINT,
    TELEGRAM_STRING_SESSION,
    START_ENDPOINT_API_KEY,
    TELEGRAM_PROXY
} from "./index";

const LOGTAIL_TOKEN = retrieveEnvVariable("logtail_token");
const LOGTAIL_ENDPOINT = retrieveEnvVariable("logtail_endpoint");

const transports: winston.transport[] = [new winston.transports.Console(), new winston.transports.File({ filename: "app.log" })];

// add logtail only when env var is available
if (LOGTAIL_TOKEN?.trim()) {
    const logtail = new Logtail(LOGTAIL_TOKEN, { endpoint: LOGTAIL_ENDPOINT });
    transports.unshift(new LogtailTransport(logtail));
}

// Array of sensitive values to check against
const sensitiveValues = [
    TELEGRAM_API_ID,
    TELEGRAM_API_HASH,
    TELEGRAM_BOT_TOKEN,
    MONGO_URI,
    SOLANA_RPC_ENDPOINT,
    SOLANA_WSS_ENDPOINT,
    TELEGRAM_STRING_SESSION,
    START_ENDPOINT_API_KEY,
    TELEGRAM_PROXY,
    LOGTAIL_TOKEN,
    LOGTAIL_ENDPOINT,
];

// Function to sanitize sensitive values in log messages
function sanitize(message: string): string {
    console.log(sensitiveValues);
    let sanitized = message;
    for (const value of sensitiveValues) {
        if (value) {
            sanitized = sanitized.split(String(value)).join('***');
        }
    }
    return sanitized;
}

export const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(
            ({ timestamp, level, message, ...meta }) => {
                const original = `${timestamp} ${level}: ${message}` + (Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "");
                const sanitized = sanitize(original)
                return sanitized;
            }
        )
    ),
    transports,
});
