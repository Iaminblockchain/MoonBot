import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { TELEGRAM_STRING_SESSION, TELEGRAM_API_ID, TELEGRAM_API_HASH } from "../index";
import { logger } from "../logger";
import { processMessages } from "./processMessages";
import { TELEGRAM_PROXY } from "../index";
import { TelegramClientParams } from "telegram/client/telegramBaseClient";

async function listenChats(client: TelegramClient): Promise<void> {
    client.addEventHandler(processMessages, new NewMessage({}));
}

export async function getTgClient(): Promise<TelegramClient> {
    try {
        const session = new StringSession(TELEGRAM_STRING_SESSION);

        const clientOptions: TelegramClientParams = {
            connectionRetries: 5,
            deviceModel: "iPhone 16 Pro",
            systemVersion: "16.0",
            appVersion: "4.3.24",
        };

        // Use the imported TELEGRAM_PROXY
        if (TELEGRAM_PROXY && TELEGRAM_PROXY.trim() !== "") {
            const [ip, port, username, password] = TELEGRAM_PROXY.split(",").map((item) => item.trim());
            clientOptions.useWSS = false;
            clientOptions.proxy = {
                ip: ip,
                port: parseInt(port, 10),
                username: username,
                password: password,
                socksType: 5,
                timeout: 30,
            };
            logger.info(`Using proxy: ${ip}:${port}`);
        }

        const client = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, clientOptions);
        await client.connect();
        // Necessary to immediately call this after connecting, otherwise messages may not be received.
        const me = await client.getMe();
        logger.info(`Telegram client connected as ${me.firstName}`);

        if (!(await client.checkAuthorization())) {
            logger.error("We can't login to the Telegram account. Please check config again.");
            process.exit(1);
        }

        return client;
    } catch (e) {
        logger.error(`Error initializing Telegram client: ${e}`);
        process.exit(1);
    }
}

export async function scrape(client: TelegramClient): Promise<void> {
    logger.info("Start monitor and scrape chats");
    try {
        await listenChats(client);
    } catch (e) {
        logger.error(`Error starting client: ${e}`);
    }
}
