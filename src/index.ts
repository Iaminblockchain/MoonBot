import * as dotenv from "dotenv";
import { retrieveEnvVariable } from "./config";
import { runAutoSellSchedule } from "./controllers/autoSellController";
dotenv.config();

const PORT = Number(retrieveEnvVariable("PORT"));
export const ALLOWED_ORIGIN = retrieveEnvVariable("allowed_origin");
export const SETUP_BOT = retrieveEnvVariable("setup_bot") === "true";
export const SETUP_SCRAPE = retrieveEnvVariable("setup_scrape") === "true";
export const TELEGRAM_BOT_TOKEN = retrieveEnvVariable("telegram_bot_token");
export const MONGO_URI = retrieveEnvVariable("mongo_url");
export const SOLANA_RPC_ENDPOINT = retrieveEnvVariable("solana_rpc_endpoint");
export const SOLANA_WSS_ENDPOINT = retrieveEnvVariable("solana_wss_endpoint");
export const JITO_TIP = Number(retrieveEnvVariable("jito_tip"));
export const TELEGRAM_API_ID = Number(retrieveEnvVariable("telegram_api_id"));
export const TELEGRAM_API_HASH = retrieveEnvVariable("telegram_api_hash");
export const TELEGRAM_STRING_SESSION = retrieveEnvVariable("telegram_string_session");
export const FEE_COLLECTION_WALLET = retrieveEnvVariable("fee_collection_wallet");
export const START_ENDPOINT_ENABLED = retrieveEnvVariable("start_endpoint_enabled") === "true";
export const START_ENDPOINT_API_KEY = retrieveEnvVariable("start_endpoint_api_key");
export const TELEGRAM_BOT_USERNAME = retrieveEnvVariable("telegram_bot_username");
export const TELEGRAM_PROXY = retrieveEnvVariable("telegram_proxy");
export const SETUP_AUTOSELL = retrieveEnvVariable("setup_autosell") === "true";

import * as db from "./db";
import { Connection } from "@solana/web3.js";
import { scrape } from "./scraper/scraper";
import * as bot from "./bot";
import { logger } from "./logger";
import { setupServer } from "./server";
import { getTgClient } from "./scraper/scraper";
import { Chat } from "./models/chatModel";
import { botInstance } from "./bot";
import mongoose from "mongoose";
import { TelegramClient } from "telegram";
import { initJoinQueue, startJoinQueue } from "./scraper/queue";
import express from "express";

export const SOLANA_CONNECTION = new Connection(SOLANA_RPC_ENDPOINT, {
    wsEndpoint: SOLANA_WSS_ENDPOINT,
    commitment: "confirmed",
});

export let client: TelegramClient | undefined;

// Service state management
type StartStatus =
    | { status: "idle" }
    | { status: "started"; id: string }
    | { status: "starting"; id: string }
    | { status: "error"; error: Error; id: string };

let serviceStatus: StartStatus = { status: "idle" };

const gracefulShutdown = async () => {
    logger.info("🗑️ Starting graceful shutdown...");

    try {
        // Close Telegram client if it exists
        if (client) {
            logger.info("🗑️ Telegram client will disconnect...");
            await client.disconnect();
            logger.info("🗑️ Telegram client disconnected");
        } else {
            logger.info("🗑️ No telegram client to disconnect");
        }
    } catch (error) {
        logger.error("🗑️ Error shutting down client", error);
    }

    try {
        // Stop Telegram bot if it exists
        if (botInstance && botInstance.isPolling()) {
            logger.info("🗑️ Telegram bot will stop polling...");
            await botInstance.stopPolling({ cancel: true });
            logger.info("🗑️ Telegram bot polling stopped");
        } else {
            logger.info("🗑️ No telegram bot to stop or not polling");
        }
    } catch (error) {
        logger.error("🗑️ Error shutting down botInstance", error);
    }

    try {
        // Close MongoDB connection
        if (mongoose.connection.readyState === 1) {
            logger.info("🗑️ MongoDB connection will close...");
            await mongoose.connection.close();
            logger.info("🗑️ MongoDB connection closed");
        } else {
            logger.info("🗑️ No MongoDB connection to close");
        }
    } catch (error) {
        logger.error("🗑️ Error shutting down mongoose:", error);
    }

    logger.info("🗑️ Graceful shutdown completed");
    process.exit(0);
};

// Graceful shutdown
// https://docs.digitalocean.com/products/app-platform/how-to/configure-termination/
process.on("SIGTERM", async () => {
    logger.info("SIGTERM received");
    await gracefulShutdown();
});

const startServices = async () => {
    try {
        // Connect to Telegram client
        logger.info("Connecting to telegram client...");
        try {
            client = await getTgClient();
        } catch (error) {
            logger.error("Error starting TG client " + error);
            throw new Error(`Failed to initialize Telegram client: ${error}`);
        }

        // Check database for chats
        const dbChats = await Chat.find({});
        logger.info("Number of chats in the DB ", { dbChats: dbChats.length });

        if (dbChats.length === 0) {
            throw new Error("No chats found in the database.");
        }

        // Initialize join queue
        logger.info("start queue");
        initJoinQueue(client, MONGO_URI);
        await startJoinQueue();

        if (SETUP_SCRAPE) {
            logger.info("Initializing scrape script...");
            await scrape(client);
        } else {
            logger.info("Skip setting up scrape");
        }

        if (SETUP_BOT) {
            logger.info("Starting TG bot...");
            bot.init(client);
        } else {
            logger.info("TG bot setup skipped (SETUP_BOT=false)");
        }

        if (SETUP_AUTOSELL) {
            logger.info("Starting auto sell schedule...");
            runAutoSellSchedule();
        }
        return true;
    } catch (error) {
        logger.error("Service initialization failed:", error);
        throw error;
    }
};

const setupStartEndpoint = (app: express.Express) => {
    const endpoint = "/start";
    logger.info(`🛠️ Will setup ${endpoint} endpoint`);
    app.post(endpoint, async (req, res) => {
        // Check for valid API key
        const apiKey = req.headers["api-key"];
        if (!apiKey || apiKey !== START_ENDPOINT_API_KEY) {
            const maskedApiKey = apiKey ? `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}` : "N/A";
            logger.info(`${endpoint} called but API key invalid`, { apiKey: maskedApiKey });
            return res.status(401).json({
                outcome: `unauthorized`,
                message: "Unauthorized",
            });
        }

        const id = req.query.id as string;
        if (!id) {
            logger.info(`${endpoint} called but no id provided`);
            return res.status(400).json({
                outcome: `error`,
                message: "id parameter is required",
            });
        }

        if (serviceStatus.status === "started") {
            logger.info(`${endpoint} called but server has already started`);
            return res.status(200).json({
                outcome: `started`,
                message: "Services already started",
                id: serviceStatus.id,
            });
        }

        if (serviceStatus.status === "error") {
            logger.info(`${endpoint} called but there was already an error starting service`, { error: serviceStatus.error });
            return res.status(500).json({
                outcome: `error`,
                message: `Services initialization previously failed: ${serviceStatus.error.message}`,
                id: serviceStatus.id,
            });
        }

        if (serviceStatus.status === "starting") {
            logger.info(`${endpoint} called but services are already starting`);
            return res.status(409).json({
                outcome: `starting`,
                message: "Services are already starting",
                id: serviceStatus.id,
            });
        }

        serviceStatus = { status: "starting", id: id };

        // Initialize services synchronously and return the result directly
        try {
            logger.info(`⏳ Starting services via ${endpoint} endpoint...`);
            await startServices();
            serviceStatus = { status: "started", id: id };
            logger.info(`✅ Services successfully started via ${endpoint} endpoint`);
            return res.status(200).json({
                outcome: `success`,
                message: "Services successfully started",
                id: id,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to initialize services via /start endpoint:", error);
            serviceStatus = { status: "error", error: error instanceof Error ? error : new Error(errorMessage), id: id };
            return res.status(500).json({
                outcome: `error`,
                message: `Failed to start services: ${errorMessage}`,
                id: id,
            });
        }
    });
    logger.info(`Waiting for call to ${endpoint} to start services...`);
};

const main = async () => {
    const app = express();

    logger.info("⏳ Launching server...");

    logger.info("🛠️ Connecting to mongo database...");
    await db.connect();

    // Currently we have a scenario where when the new deployment starts, it's running in parallel with the old one until the healthcheck
    // is complete and the new one is made public. A side effect of this is we temporarily have 2 simultaneous connections to mongo/telegram
    // which could cause data corruption. We need to ensure that in production, the server isn't started immediately but only after it's received a
    // start signal (via an endpoint) which occurs after the previous deployment has already shutdown.
    if (START_ENDPOINT_ENABLED) {
        setupStartEndpoint(app);
    } else {
        // In local dev, we want to start services immediately
        const startId = "local-dev";
        try {
            await startServices();
            serviceStatus = { status: "started", id: startId };
            logger.info("✅ Services successfully started!");
        } catch (error) {
            logger.error("Failed to start services:", error);
            serviceStatus = { status: "error", error: error instanceof Error ? error : new Error(String(error)), id: startId };
            throw serviceStatus.error;
        }
    }

    await setupServer(app, PORT, START_ENDPOINT_ENABLED, () => serviceStatus.status === "started");
    logger.info("✅ Server successfully launched");
};

main().catch((error) => {
    logger.error("Server initialization failed:", error);
    process.exit(1);
});
