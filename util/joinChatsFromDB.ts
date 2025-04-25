// joinAllGroups.ts

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import mongoose from "mongoose";
import { retrieveEnvVariable } from '../src/config';
import { logger } from './util';
import { joinChannelsDB } from '../src/scraper/manageGroups';

const TELEGRAM_API_ID = Number(retrieveEnvVariable("telegram_api_id"));
const TELEGRAM_API_HASH = retrieveEnvVariable("telegram_api_hash");
const TELEGRAM_STRING_SESSION = retrieveEnvVariable("telegram_string_session");
const MONGO_URI = retrieveEnvVariable("mongo_url");

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

(async () => {
    try {
        await mongoose.connect(MONGO_URI);
        const client = await getTgClient();

        await joinChannelsDB(client);

        await client.disconnect();
        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        logger.error("Error in joinAllGroups:", err);
        process.exit(1);
    }
})();