//scraper listening to predefined groups

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { TELEGRAM_STRING_SESSION, TELEGRAM_API_ID, TELEGRAM_API_HASH } from "../index";
import { logger } from '../util';
import { Chat } from "../models/chatModel";
import { processMessages } from "./processMessages";
import type { NewMessageEvent } from "telegram/events/NewMessage";

export let lastUpdateTimestamp = Date.now();

// per‑channel pts for GetChannelDifference
const channelPts = new Map<bigint, number>();

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
// Telegram has written a guide on it here: https://core.telegram.org/api/updates  which specifies implementing requirements in the Recovering gaps section.
// `updates.getDifference (common/secret state)` is needed to get the latest updates in specific cases.

//if we haven't received a message in some time trigger update
export function startUpdateFallback(client: TelegramClient): void {
  setInterval(async () => {
    const now = Date.now();
    if (now - lastUpdateTimestamp > 60 * 1000) {
      //const internalClient = client as any;
      //ensures client has a valid update state before calling getDifference
      let state: Api.updates.State;
      try {
        state = await client.invoke(new Api.updates.GetState());
      } catch (error) {
        logger.error("error getting state");
        return;
      }

      try {
        logger.info(`Calling getDifference due to inactivity`);
        const diff = await client.invoke(
          new Api.updates.GetDifference({
            pts: state.pts,
            date: state.date,
            qts: state.qts,
          })
        );

        if ("newMessages" in diff && Array.isArray(diff.newMessages)) {
          for (const msg of diff.newMessages) {
            if (msg instanceof Api.Message) {
              const event = {
                message: msg,
                originalUpdate: diff,
              } as any as NewMessageEvent;

              await processMessages(event);
              lastUpdateTimestamp = Date.now();
            } else {
              logger.error("unknown update type");
            }
          }
        }

        if ("otherUpdates" in diff && Array.isArray(diff.otherUpdates)) {
          for (const upd of diff.otherUpdates) {
            if (upd instanceof Api.UpdateChannelTooLong) {
              const chanId = BigInt(upd.channelId.toString());
              const chanPts = channelPts.get(chanId) ?? 0;

              logger.info(`Channel ${chanId} too long—calling getChannelDifference`, { pts: chanPts });
              const channel = await client.getEntity(upd.channelId);
              await client.invoke(new Api.updates.GetChannelDifference({
                channel,
                filter: new Api.ChannelMessagesFilterEmpty(),
                pts: chanPts,
              }));
            }
          }
        }


      } catch (err) {
        logger.error("Error in getDifference", err);
      }
    }
  }, 60_000);
}

// Listen to channels in the DB
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
    // start fallback in case we don't receive messages
    startUpdateFallback(client);

  } catch (e) {
    console.error(`Error starting client: ${e}`);
  }
}