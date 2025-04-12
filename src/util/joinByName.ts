//utility to join chat by name

import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import readline from "readline";
import { retrieveEnvVariable } from "../config";
import { logger } from "../util";
import { joinChannelByName } from "../scraper/manageGroups";

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


// Ask user for input
function askInput(prompt: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(prompt, ans => {
        rl.close();
        resolve(ans);
    }));
}

(async () => {
    const channelName = await askInput("Enter Telegram channel name (e.g., @solsignals or https://t.me/solsignals): ");
    const client = await getTgClient();
    const dialogs = await client.getDialogs({});
    await joinChannelByName(client, channelName, dialogs);
    process.exit(0);
})();