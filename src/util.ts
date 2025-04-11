import winston from "winston";

export const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...metadata }) => {
            const metadataStr = Object.keys(metadata).length ? ` ${JSON.stringify(metadata)}` : '';
            return `${timestamp} ${level}: ${message}${metadataStr}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "app.log" })
    ]
});