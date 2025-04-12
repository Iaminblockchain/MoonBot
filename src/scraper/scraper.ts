//scraper listening to predefined groups

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { TELEGRAM_STRING_SESSION, TELEGRAM_API_ID, TELEGRAM_API_HASH } from "../index";
import { logger } from '../util';
import { Chat } from "../models/chatModel";

import { processMessages } from "./processMessages";
import { tgClient } from "telegram/client";

// Listen to channels in the DB
async function listenChats(client: TelegramClient): Promise<void> {
  const all_chats = await Chat.find({}, 'chat_id');

  logger.info(`Fetched chats from DB`, { count: all_chats.length });

  //TODO check if we have joined the channels
  // for now assume we joined already

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

// init Telegram client
export async function getTgClient(): Promise<TelegramClient> {
  try {
    const session = new StringSession(TELEGRAM_STRING_SESSION);
    const client = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, {
      connectionRetries: 5,
    });

    // Connect to the Telegram client
    await client.connect();

    // Check user's authorization
    if (!(await client.checkAuthorization())) {
      logger.error("We can't login to the Telegram account. Please check config again.");
      process.exit(1);
    }

    return client;
  } catch (e) {
    logger.error(`Error initializing Telegram client: ${e}`);
    process.exit(1);  // Exit the process if the client can't be initialized
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

// Main function to start the client
export async function scrape(client: TelegramClient): Promise<void> {
  logger.info("start monitor and scrape chats");
  try {

    // Listen to channels defined in DB
    await listenChats(client);

  } catch (e) {
    console.error(`Error starting client: ${e}`);
  }
}