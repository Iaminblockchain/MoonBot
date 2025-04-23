//scraper listening to predefined groups

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { TELEGRAM_STRING_SESSION, TELEGRAM_API_ID, TELEGRAM_API_HASH } from "../index";
import { logger } from '../util';
import { Chat } from "../models/chatModel";
import { processMessages } from "./processMessages";
import { NewMessageEvent } from "telegram/events/NewMessage";
export let lastUpdateTimestamp = Date.now();

// per‑channel pts for GetChannelDifference
const channelPts = new Map<bigint, number>();
// a symbol‐key to store state on the client without colliding
const STATE_HOLDER = Symbol("updatesStateHolder");

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

async function initializeUpdateState(client: TelegramClient) {
  const initState = await client.invoke(new Api.updates.GetState());
  ; (client as any)[STATE_HOLDER] = { state: initState as Api.updates.State };
  logger.info("Fetched initial updates.State", initState);
}


// Every minute of silence, run GetDifference against our stored state
// If the state is ever missing, log & skip.
export function startUpdateFallback(client: TelegramClient): void {
  if (!(client as any)[STATE_HOLDER]) {
    logger.error("Cannot start fallback—no initial updates.State. Did you call getTgClient()?");
    return;
  }

  setInterval(async () => {
    const holder = (client as any)[STATE_HOLDER] as { state: Api.updates.State } | undefined;
    if (!holder) {
      logger.warn("Missing updates State, skipping getDifference");
      return;
    }

    const { pts, date, qts } = holder.state;
    if (Date.now() - lastUpdateTimestamp <= 60_000) return;

    try {
      logger.info("Calling GetDifference due to inactivity", { pts, date, qts });
      const diff = await client.invoke(
        new Api.updates.GetDifference({ pts, date, qts })
      );

      // ─── handle newMessages ───────────────────────
      if ("newMessages" in diff && Array.isArray(diff.newMessages)) {
        // We are now sure diff is Difference or DifferenceSlice (never Empty)
        const fullDiff = diff as Api.updates.Difference | Api.updates.DifferenceSlice;

        for (const msg of fullDiff.newMessages) {
          if (msg instanceof Api.Message) {
            // Re‑wrap the raw message in a NewMessageEvent
            const ev = new NewMessageEvent(
              msg,
              fullDiff as unknown as Api.TypeUpdates
            );
            ev._setClient(client);
            await processMessages(ev);
            lastUpdateTimestamp = Date.now();
          }
        }
      }

      // ─── handle channel‐too‐long ──────────────────
      if (Array.isArray((diff as any).otherUpdates)) {
        for (const upd of (diff as any).otherUpdates) {
          if (upd instanceof Api.UpdateChannelTooLong) {
            const chanId = BigInt(upd.channelId.toString());
            // grab the pts it gives you (falling back to whatever you’d stored)
            const startPts = typeof upd.pts === "number"
              ? upd.pts
              : (channelPts.get(chanId) ?? 0);

            const channel = await client.getEntity(upd.channelId);
            const chanDiff = await client.invoke(
              new Api.updates.GetChannelDifference({
                channel,
                filter: new Api.ChannelMessagesFilterEmpty(),
                pts: startPts,
              })
            );

            // process chanDiff.new_messages or chanDiff.other_updates
            // then store the new pts so next time you have a non-zero default:
            if ("pts" in chanDiff) {
              channelPts.set(chanId, (chanDiff as any).pts);
            }
          }
        }
      }

      // ─── update stored state ──────────────────────
      const newState = (diff as any).state || (diff as any).intermediate_state;
      if (newState) {
        holder.state = newState;
      } else {
        // fallback if we got differenceTooLong, etc.
        await initializeUpdateState(client);
      }
    } catch (err) {
      logger.error("Error in getDifference", err);
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
    await initializeUpdateState(client);

    // Listen to channels defined in DB
    await listenChats(client);
    // start fallback in case we don't receive messages
    startUpdateFallback(client);

  } catch (e) {
    console.error(`Error starting client: ${e}`);
  }
}