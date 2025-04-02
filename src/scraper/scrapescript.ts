import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { scheduleJob } from "node-schedule";
import { getAllActiveChannels } from "../models/copyTradeModel";
import { onSignal } from "../controllers/copytradeController";
import { TELEGRAM_STRING_SESSION, TELEGRAM_API_ID, TELEGRAM_API_HASH } from "../index";
import { ScrapeStats } from "../models/scrapeStats";
import { logger } from '../util';
import { Chat } from "../models/chatModel";
import { Call } from "../models/callModel";

//TODO raydium or others?
const PUMP_FUN_CA_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

// List of chat IDs to monitor
let MONITORED_CHAT_IDS: number[] = [];
let NEW_MONITORED_CHAT_IDS: number[] = [];
let ALL_CHATS: { username: string | null; id: number }[] = [];
let client: TelegramClient;


// Global counters
let totalMessagesRead = 0;
const uniqueIncomingChannelIds: Set<number> = new Set();
let totalContractAddressesFound = 0;

// Process incoming messages
async function processMessages(event: NewMessageEvent): Promise<void> {
  try {
    totalMessagesRead++; // Increment message counter
    logger.info(`Total messages read: ${totalMessagesRead} from channels`);

    logger.info(`evnt ${event}`);
    const messageText = event.message.text || "";
    const channelId = event.message.senderId;
    if (!channelId) return;
    const id = -(channelId.toJSNumber() % 10000000000);
    uniqueIncomingChannelIds.add(id);

    logger.info(`New message: ${messageText} - ${channelId}`);
    const chatRecord = ALL_CHATS.find(chat => chat.id === id);
    const channelUsername = chatRecord ? chatRecord.username : null;
    if (channelUsername) {
      // Update the Chat record: increment message_count
      await Chat.findOneAndUpdate(
        { chat_id: channelUsername },
        { $inc: { message_count: 1 } },
        { upsert: true, new: true }
      );
    }

    const contractAddresses = messageText.match(PUMP_FUN_CA_REGEX) || [];
    logger.info(`Detected addresses: ${contractAddresses}`);

    if (contractAddresses.length > 0) {
      // Increment the contract addresses counter by the number found in this message
      totalContractAddressesFound += contractAddresses.length;
      let channelUsername: string | null = "";
      for (const chat of ALL_CHATS) {
        if (chat.id === id) {
          channelUsername = chat.username;
          break;
        }
      }
      if (channelUsername) {
        onSignal(channelUsername, contractAddresses[0]!);
        // Create a call record using the Call model
        try {
          const callRecord = new Call({
            chat_id: channelUsername,          // using channel username as chat id
            token_id: contractAddresses[0],      // first contract address found
            message_date: new Date(),            // current date/time as message date
            // creationdate will default to now
          });
          await callRecord.save();
          logger.info(`Saved call record for channel ${channelUsername} with token ${contractAddresses[0]}`);
        } catch (err) {
          logger.error(`Error saving call record: ${err}`);
        }
      }
    }
  } catch (e) {
    console.error(`Error processing message: ${e}`);
  }
}

// Update monitored chats
async function monitorMessages(): Promise<void> {
  MONITORED_CHAT_IDS = [...NEW_MONITORED_CHAT_IDS];
  client.removeEventHandler(processMessages, new NewMessage({}));
  client.addEventHandler(
    processMessages,
    new NewMessage({ chats: MONITORED_CHAT_IDS })
  );
}

// Join a Telegram channel
async function joinChannel(channelName: string): Promise<void> {
  logger.info('joinChannel');
  try {
    const result: any = await client.invoke(
      new Api.channels.JoinChannel({
        channel: channelName,
      })
    );
    const channelId = result?.chats[0].id.toJSNumber();

    NEW_MONITORED_CHAT_IDS.push(channelId);
    ALL_CHATS.push({ username: channelName, id: channelId });
    logger.info(`Detecting Channel list: ${NEW_MONITORED_CHAT_IDS}`);
  } catch (e) {
    console.error(`joinChannel Error: ${e}`);
  }
}

// Listen to predefined channels
async function listentopredefined(): Promise<void> {
  const predefinedChats = await Chat.find({}, 'chat_id');
  const predefinedChannels = predefinedChats.map(chat => chat.chat_id);

  for (const channel of predefinedChannels) {
    await joinChannel(channel);
  }

  // Find the channel IDs for the predefined channels from ALL_CHATS
  const predefinedChannelIds = predefinedChannels.map((channel) => {
    const found = ALL_CHATS.find(chat => chat.username === channel);
    return found ? found.id : null;
  }).filter(id => id !== null) as number[];

  if (predefinedChannelIds.length > 0) {
    client.addEventHandler(
      processMessages,
      new NewMessage({ chats: predefinedChannelIds })
    );
    logger.info(`Listening to predefined channels: ${predefinedChannels.join(", ")}`);
  } else {
    logger.error(`Predefined channels not found after joining.`);
  }
}

// Find and monitor chats the user already is in
async function findMonitorChats(): Promise<void> {
  logger.info('findMonitorChats');
  try {
    ALL_CHATS = [];

    // Check all dialogues a user is in
    for await (const dialog of client.iterDialogs()) {
      try {
        const entity = dialog.entity as any;
        if (entity.username) {
          ALL_CHATS.push({ username: entity.username, id: entity.id });
        }
      } catch (e) {
        console.error(`Error: ${e} - ${dialog.title}`);
        continue;
      }
    }

    const allSignals: string[] = await getAllActiveChannels();
    logger.info(`all signal: ${allSignals}`);

    NEW_MONITORED_CHAT_IDS = [];
    for (const signal of allSignals) {
      let joined = false;
      for (const chat of ALL_CHATS) {
        if (chat.username === signal) {
          NEW_MONITORED_CHAT_IDS.push(chat.id);
          joined = true;
          break;
        }
      }
      if (!joined) {
        await joinChannel(signal);
      }
    }

    if (
      JSON.stringify(NEW_MONITORED_CHAT_IDS) !== JSON.stringify(MONITORED_CHAT_IDS)
    ) {
      await monitorMessages();
    }
    logger.info(`MONITORED_CHAT_IDS - ${MONITORED_CHAT_IDS}`);
  } catch (e) {
    console.error(`Error processing data: ${e}`);
  }
}

// Report stats every minute and update the DB
async function reportStats(): Promise<void> {
  logger.info(
    `Report: Total messages read: ${totalMessagesRead} from ${uniqueIncomingChannelIds.size} unique channels, Contracts found: ${totalContractAddressesFound}`
  );
  try {
    // Upsert a singleton document to store your stats
    await ScrapeStats.findOneAndUpdate(
      {},
      {
        totalMessagesRead,
        uniqueIncomingChannelCount: uniqueIncomingChannelIds.size,
        contractsFound: totalContractAddressesFound,
      },
      { upsert: true, new: true }
    );
    logger.info('Scrape stats updated in DB');
  } catch (error) {
    logger.error("Failed to update scrape_stats", error);
  }
}

// Main function to start the client
export async function scrape(): Promise<void> {
  logger.info('start script');
  try {
    const session = new StringSession(TELEGRAM_STRING_SESSION);
    client = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, {
      connectionRetries: 5,
    });

    // Start the Telegram client
    await client.connect();

    if (!(await client.checkAuthorization())) {
      logger.error("We can't login Telegram account. Please check config again.");
      process.exit(1);
    }
    logger.info("Monitoring chats for pump.fun CAs...");

    // Start immediate chat monitoring for dynamic channels
    await findMonitorChats();
    scheduleJob("*/1 * * * *", findMonitorChats);

    // Listen to predefined channels
    await listentopredefined();

    // Schedule stats report every minute
    scheduleJob("*/1 * * * *", reportStats);

  } catch (e) {
    console.error(`Error starting client: ${e}`);
  }
}