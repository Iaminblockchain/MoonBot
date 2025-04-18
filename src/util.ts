import winston from "winston";
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";
import { retrieveEnvVariable } from "./config";

const LOGTAIL_TOKEN = retrieveEnvVariable("logtail_token");
const LOGTAIL_ENDPOINT = retrieveEnvVariable("logtail_endpoint");

const logtail = new Logtail(LOGTAIL_TOKEN, {
    endpoint: LOGTAIL_ENDPOINT
});

export const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) =>
            `${timestamp} ${level}: ${message}` +
            (Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "")
        )
    ),
    transports: [
        new LogtailTransport(logtail),
        new winston.transports.Console(),
        new winston.transports.File({ filename: "app.log" })
    ]
});