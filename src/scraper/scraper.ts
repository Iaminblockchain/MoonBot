import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { TELEGRAM_STRING_SESSION, TELEGRAM_API_ID, TELEGRAM_API_HASH } from "../index";
import { logger } from "../logger";
import { processMessages } from "./processMessages";
import { TELEGRAM_PROXY } from "../index";

async function listenChats(client: TelegramClient): Promise<void> {
    client.addEventHandler(processMessages, new NewMessage({}));
}

export async function getTgClient(): Promise<TelegramClient> {
    try {
        const session = new StringSession(TELEGRAM_STRING_SESSION);

        const clientOptions: any = {
            connectionRetries: 5,
        };

        // Use the imported TELEGRAM_PROXY
        if (TELEGRAM_PROXY && TELEGRAM_PROXY.trim() !== '') {
            const [ip, port, username, password] = TELEGRAM_PROXY.split(',').map(item => item.trim());
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
        await scheduleReconnect(client);
    } catch (e) {
        logger.error(`Error starting client: ${e}`);
    }
}

// https://github.com/LonamiWebs/Telethon/issues/4521#issuecomment-2843950375
function scheduleReconnect(client: TelegramClient): void {
    setInterval(async () => {
        try {
            logger.info("Disconnecting client for scheduled reconnect");
            await client._disconnect();

            logger.info("Waiting 30 seconds before reconnecting");
            await new Promise(resolve => setTimeout(resolve, 30000));

            logger.info("Reconnecting client");
            await client.connect();

            const me = await client.getMe();
            logger.info(`Telegram client connected as ${me.firstName}`);

            // Re-establish message handler after reconnection
            await listenChats(client);
        } catch (e) {
            logger.error(`Error during scheduled reconnect: ${e}`);
        }
    }, 30 * 60 * 1000); // 30 minutes in milliseconds
}
