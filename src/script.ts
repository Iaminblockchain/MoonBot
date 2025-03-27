import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { scheduleJob } from "node-schedule";
import { getAllChannel } from "./models/copyTradeModel";
import { onSignal } from "./controllers/copytradeController";
import { retrieveEnvVariable } from "./config";

const API_ID = Number(retrieveEnvVariable("telegram_api_id"));
const API_HASH = retrieveEnvVariable("telegram_api_hash");
const TELEGRAM_STRING_SESSION = retrieveEnvVariable("tellegram_string_session");
const session = new StringSession(
  TELEGRAM_STRING_SESSION
); // Persistent session; save this after first login
const client = new TelegramClient(session, API_ID, API_HASH, {
  connectionRetries: 5,
});
const PUMP_FUN_CA_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

// List of chat IDs to monitor
let MONITORED_CHAT_IDS: number[] = [];
let NEW_MONITORED_CHAT_IDS: number[] = [];
let ALL_CHATS: { username: string | null; id: number }[] = [];

// Process incoming messages
async function processMessages(event: NewMessageEvent): Promise<void> {
  try {
    console.log("evnt", event);
    const messageText = event.message.text || "";
    const channelId = event.message.senderId;
    if (!channelId) return;
    const id = -(channelId.toJSNumber() % 10000000000);

    console.log(`New message: ${messageText} - ${channelId}`); // Debug
    const contractAddresses = messageText.match(PUMP_FUN_CA_REGEX) || [];
    console.log(`Detected addresses: ${contractAddresses}`); // Debug

    if (contractAddresses.length > 0) {
      let channelUsername: string | null = "";
      for (const chat of ALL_CHATS) {
        if (chat.id == id) {
          // Adjust for Telegram's -100 prefix
          channelUsername = chat.username;
          break;
        }
      }
      // console.log(`Send 3000/signal - address: ${contractAddresses[0]}, channel: ${channelUsername}`);
      if (channelUsername) {
        // await fetch(`http://localhost:${SERVER_PORT}/signal`, {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify({
        //     address: contractAddresses[0],
        //     channel: channelUsername,
        //   }),
        // });

        onSignal(channelUsername, contractAddresses[0]!)
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
  try {
    const result: any = await client.invoke(
      new Api.channels.JoinChannel({
        channel: channelName,
      })
    );
    const channelId = result?.chats[0].id.toJSNumber();

    NEW_MONITORED_CHAT_IDS.push(channelId); // Adjust for Telegram's -100 prefix
    ALL_CHATS.push({ username: channelName, id: channelId });
    console.log(`Detecting Channel list: ${NEW_MONITORED_CHAT_IDS}`);
  } catch (e) {
    console.error(`joinChannel Error: ${e}`);
  }
}

// Find and monitor chats
async function findMonitorChats(): Promise<void> {
  try {
    ALL_CHATS = [];
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

    const allSignals: string[] = await getAllChannel();
    console.log(`all signal: ${allSignals}`);

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
      JSON.stringify(NEW_MONITORED_CHAT_IDS) !==
      JSON.stringify(MONITORED_CHAT_IDS)
    ) {
      await monitorMessages();
    }
    console.log(`MONITORED_CHAT_IDS - ${MONITORED_CHAT_IDS}`);
  } catch (e) {
    console.error(`Error processing data: ${e}`);
  }
}

// Main function to start the client
export async function script(): Promise<void> {
  try {
    // Start the Telegram client
    await client.connect();

    if (!(await client.checkAuthorization())) {
      console.error("We can't login Telegram account. Please check config again.");
      process.exit(1);
    }
    console.log("Monitoring chats for pump.fun CAs...");
    // Save session string for future runs

    // Schedule chat monitoring every minute
    scheduleJob("*/1 * * * *", findMonitorChats);
    // await joinChannel("PiAnnouncements");

  } catch (e) {
    console.error(`Error starting client: ${e}`);
  }
}
