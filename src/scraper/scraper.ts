import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { TELEGRAM_STRING_SESSION, TELEGRAM_API_ID, TELEGRAM_API_HASH } from "../index";
import { logger } from '../logger';
import { processMessages } from "./processMessages";

// https://trello.com/c/4VaLJ7N8
// There are some circumstances that messages from telegram aren't emitted to us and we require manually polling.
// This has been reported multiple times:
// https://github.com/gram-js/gramjs/issues/575
// https://github.com/gram-js/gramjs/issues/280
// https://github.com/gram-js/gramjs/issues/654
// https://github.com/gram-js/gramjs/issues/561
// https://github.com/gram-js/gramjs/issues/494
// https://github.com/gram-js/gramjs/issues/682
// https://github.com/LonamiWebs/Telethon/issues/4345
// Telegram has written a guide on it here: https://core.telegram.org/api/updates
// Other users have suggested the following:
// - One user from one of the above issues said they had success with calling getDialogs (https://github.com/gram-js/gramjs/issues/654#issuecomment-2029487203) periodically
// - Another said calling getMe (https://github.com/gram-js/gramjs/issues/494#issuecomment-1593398280) periodically worked
// 
// We will try reconnecting every 25 minutes
// https://github.com/gram-js/gramjs/issues/682#issuecomment-2169838423
function restartConnectionPeriodically(client: TelegramClient): void {
  const minutes = 1;
  logger.info(`Will reconnect to Telegram every ${minutes} minutes`);
  setInterval(async () => {
    logger.info(`${minutes} minutes passed, reconnecting to Telegram...`);
    try {
      await client.getMe();
      logger.info(`Did reconnect to Telegram`);
    } catch (error) {
      logger.error(`Error reconnecting to Telegram: ${error}`);
    }
  }, 1000 * 60 * minutes);
}

async function listenChats(client: TelegramClient): Promise<void> {
  client.addEventHandler(
    processMessages,
    new NewMessage({})
  );
}

export async function getTgClient(): Promise<TelegramClient> {
  try {
    const session = new StringSession(TELEGRAM_STRING_SESSION);
    const client = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, {
      connectionRetries: 5,
    });
    await client.connect();
    const me = await client.getMe();
    logger.info(`Telegram client connected as ${me.username}`)

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
    restartConnectionPeriodically(client);
  } catch (e) {
    logger.error(`Error starting client: ${e}`);
  }
}
