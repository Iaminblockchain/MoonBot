import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { TELEGRAM_STRING_SESSION, TELEGRAM_API_ID, TELEGRAM_API_HASH } from "../index";
import { logger } from '../util';
import { Chat } from "../models/chatModel";
import { processMessages } from "./processMessages";
import { NewMessageEvent } from "telegram/events/NewMessage";

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
// We will try Poll getDialogs every minute to keep connection alive
function startGetDialogsPoll(client: TelegramClient): void {
  setInterval(async () => {
    try {
      await client.getDialogs({});
      logger.debug("Polled getDialogs to keep connection alive");
    } catch (err) {
      logger.error("Error polling getDialogs", err);
    }
  }, 60_000);
}

async function listenChats(client: TelegramClient): Promise<void> {
  const all_chats = await Chat.find({}, 'chat_id');
  logger.info(`Fetched chats from DB`, { count: all_chats.length });

  const allChatIds = all_chats
    .map(chat => Number(chat.chat_id))
    .filter(id => !isNaN(id));

  logger.debug(`Parsed chat IDs`, { ids: allChatIds });

  if (allChatIds.length > 0) {
    client.addEventHandler(
      processMessages,
      new NewMessage({ chats: allChatIds })
    );
    logger.info(`Listening to chats`, { count: allChatIds.length });
  } else {
    logger.error(`No valid chat IDs found`, { allChatIds });
  }
}

export async function getTgClient(): Promise<TelegramClient> {
  try {
    const session = new StringSession(TELEGRAM_STRING_SESSION);
    const client = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, {
      connectionRetries: 5,
    });
    await client.connect();

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

export async function checkJoined(client: TelegramClient, name: string): Promise<boolean> {
  const channelName = name.replace("https://t.me/", "").replace("@", "").trim();
  try {
    const dialogs = await client.getDialogs({});
    const found = dialogs.some(dialog => {
      const entity = dialog.entity as any;
      return entity?.username?.toLowerCase() === channelName.toLowerCase();
    });
    logger.info(`checkJoined: ${channelName} is ${found ? "already joined" : "not joined"}`);
    return found;
  } catch (e: any) {
    logger.error(`checkJoined error: ${e.message || e}`);
    return false;
  }
}

export async function scrape(client: TelegramClient): Promise<void> {
  logger.info("start monitor and scrape chats");
  try {
    await listenChats(client);
    startGetDialogsPoll(client);
  } catch (e) {
    logger.error(`Error starting client: ${e}`);
  }
}
