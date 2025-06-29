import express from "express";
import { logger } from "./logger";
import { Chat } from "./models/chatModel";
import { Call } from "./models/callModel";
import cors from "cors";
import { ALLOWED_ORIGIN } from ".";
import { client } from "./index";
import { botInstance } from "./bot";
import mongoose from "mongoose";
import { lastMessageLog } from "./scraper/processMessages";

const serverStartTime = new Date();

const setupStatusChecks = (app: express.Application): void => {
    app.get("/health", (_, res) => {
        res.status(200).send("OK");
    });

    app.get("/services", (_, res) => {
        const telegramConnected = client?.connected || false;
        const botPolling = botInstance?.isPolling() || false;
        const mongoConnected = mongoose.connection.readyState === 1;

        const allServicesHealthy = telegramConnected && botPolling && mongoConnected;

        if (allServicesHealthy) {
            res.status(200).json({
                status: "healthy",
                services: {
                    telegram: "connected",
                    bot: "polling",
                    mongodb: "connected",
                },
            });
        } else {
            res.status(503).json({
                status: "unhealthy",
                services: {
                    telegram: telegramConnected ? "connected" : "disconnected",
                    bot: botPolling ? "polling" : "not polling",
                    mongodb: mongoConnected ? "connected" : "disconnected",
                },
            });
        }
    });

    app.get("/last-message", (_, res) => {
        const timeoutMinutes = 300;
        if (lastMessageLog) {
            const now = new Date();
            const secondsSince = Math.floor((now.getTime() - lastMessageLog.date.getTime()) / 1000);

            // Format time as hours:minutes:seconds
            const hours = Math.floor(secondsSince / 3600);
            const minutes = Math.floor((secondsSince % 3600) / 60);
            const seconds = secondsSince % 60;
            const timeSinceLastMessage = `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

            const responseData = {
                serverStartTime,
                lastMessage: lastMessageLog,
                timeSinceLastMessage,
            };

            // If the message is older than 5 minutes (300 seconds), return 500
            if (secondsSince > timeoutMinutes) {
                res.status(500).json(responseData);
            } else {
                res.status(200).json(responseData);
            }
        } else {
            const secondsSinceStart = Math.floor((new Date().getTime() - serverStartTime.getTime()) / 1000);

            // If no message has been emitted within the timeoutMinutes, return 500
            res.status(secondsSinceStart > timeoutMinutes ? 500 : 200).json({
                serverStartTime,
                lastMessage: null,
                timeSinceLastMessage: null,
            });
        }
    });
};

export const setupServer = (
    app: express.Application,
    port: number,
    startEndpointEnabled = false,
    isServicesStarted = () => false
): Promise<void> => {
    logger.info("Will setup cors with allowed origin", { allowedOrigin: ALLOWED_ORIGIN });

    app.use(cors({ origin: ALLOWED_ORIGIN }));

    app.use(express.static("public"));
    app.use(express.json());

    setupStatusChecks(app);

    // Services check middleware for API endpoints
    const checkServicesStarted = (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (!startEndpointEnabled || isServicesStarted()) {
            return next();
        }

        return res.status(503).header("Retry-After", "60").json({ error: "Services not started yet. Call /start to initialize services." });
    };

    app.get("/api/chats", checkServicesStarted, async (_, res) => {
        try {
            const chats = await Chat.find({});
            res.json(chats);
        } catch (error) {
            logger.error("Failed to fetch chats", error);
            res.status(500).json({ error: "Error fetching chats" });
        }
    });

    app.get("/api/calls", checkServicesStarted, async (_, res) => {
        try {
            const calls = await Call.find({});
            res.json(calls);
        } catch (error) {
            logger.error("Failed to fetch calls", error);
            res.status(500).json({ error: "Error fetching calls" });
        }
    });

    return new Promise<void>((resolve) => {
        app.listen(port, () => {
            logger.info(`Server listening on port ${port}`);
            resolve();
        });
    });
};
