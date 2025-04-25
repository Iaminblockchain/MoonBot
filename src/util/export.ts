import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import { logger } from "../util";
import { retrieveEnvVariable } from "../config";
import * as fs from "fs";
import * as path from "path";

export let client: TelegramClient | undefined;

export const TELEGRAM_API_ID = Number(retrieveEnvVariable("telegram_api_id"));
export const TELEGRAM_API_HASH = retrieveEnvVariable("telegram_api_hash");
export const TELEGRAM_STRING_SESSION = retrieveEnvVariable("telegram_string_session");

// Get Telegram client
async function getTgClient(): Promise<TelegramClient> {
    const session = new StringSession(TELEGRAM_STRING_SESSION);
    const client = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, {
        connectionRetries: 5,
    });

    await client.connect();

    if (!(await client.checkAuthorization())) {
        logger.error("Authorization failed. Please log in manually and update your session.");
        process.exit(1);
    }

    return client;
}


async function exportUserChannels(): Promise<void> {
    logger.info("listUserChannels");

    client = await getTgClient();

    logger.info("Session string:", client.session.save());

    const dialogs = await client.getDialogs({});
    const channels = [];

    for (const dialog of dialogs) {
        if (dialog.isChannel && dialog.entity instanceof Api.Channel) {
            const entity = dialog.entity;
            const title = entity.title ?? "";
            const username = entity.username ?? null;
            const id = entity.id.valueOf?.() ?? entity.id;
            channels.push({ title, username, id });
            logger.info(title + " " + username + " " + id);
        }
    }

    const filePath = path.join(__dirname, "../../data/NEW_channels.json");
    fs.writeFileSync(filePath, JSON.stringify(channels, null, 2));
    logger.info(`✅ Saved channel list to ${filePath}. Number of channels: ${channels.length}`);

    process.exit(0);
}

(async () => {
    await exportUserChannels();
})();