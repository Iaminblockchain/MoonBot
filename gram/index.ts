import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { MongoClient, Db, Collection } from 'mongodb';
import * as dotenv from 'dotenv';
import { scheduleJob } from 'node-schedule';
import promptSync from 'prompt-sync';

import {} from 'telegram/tl/api';

// Load environment variables from .env file
dotenv.config();
const prompt = promptSync({ sigint: true });
const API_ID = 24263131;
const API_HASH = 'c237590a557ca6dace22fb2f116ec904';
const PHONE_NUMBER = "971582150614" ; // Include country code, e.g., +1234567890
const SERVER_PORT = process.env.SERVER_PORT || '3000';

console.log("apaia", API_HASH, API_ID)

const session = new StringSession('1BAAOMTQ5LjE1NC4xNjcuOTEAUH/fFv+yJqurda8JCgyaFaf3egj2+/7Eo1GHZ0evAgRkOIxuJk7sa/puvGFPItPpvD8piaiNeZnXoJGVvAjk5oYyrcUG0zm0WaR23C3ODgCv8N6VCgWfybJbwmSMPVj+b0SbKwZ9RTSrrYhDDOgoQfscEr0MB2qYRnwta1UIjS61BnxSLKohF/aI83o/l1t/CHGxtvJqFRhulAbNs1RDFkzH+OgRVcYdHSXRMp0YlaCiUIee8NMSRuL+aYfmSj9hX8rSI+pEYXx49ya5DWLi6SX8BFy1H2oRxzJJKzKcpqsCFe0oAeztQLoWK9xxgIQfCLtt9mFkAxsBfT1WiWXlYMg='); // Persistent session; save this after first login
const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });

// MongoDB setup
const mongoClient = new MongoClient('mongodb://localhost:27017/');
let db: Db;
let collection: Collection;

// Regex to detect pump.fun contract addresses
const PUMP_FUN_CA_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

// List of chat IDs to monitor
let MONITORED_CHAT_IDS: number[] = [];
let NEW_MONITORED_CHAT_IDS: number[] = [];
let ALL_CHATS: { username: string | null; id: number }[] = [];

// Process incoming messages
async function processMessages(event: NewMessageEvent): Promise<void> {
  try {
    console.log("evnt", event)
    const messageText = event.message.message || '';
    // const channelId = event.message.peerId?.channelId?.toJSNumber();
    // if (!channelId) return;

    // // console.log(`New message: ${messageText} - ${channelId}`); // Debug
    // const contractAddresses = messageText.match(PUMP_FUN_CA_REGEX) || [];
    // // console.log(`Detected addresses: ${contractAddresses}`); // Debug

    // if (contractAddresses.length > 0) {
    //   let channelUsername: string | null = '';
    //   for (const chat of ALL_CHATS) {
    //     if (chat.id === -1000000000000 - channelId) { // Adjust for Telegram's -100 prefix
    //       channelUsername = chat.username;
    //       break;
    //     }
    //   }
    //   // console.log(`Send 3000/signal - address: ${contractAddresses[0]}, channel: ${channelUsername}`);
    //   if (channelUsername) {
    //     await fetch(`http://localhost:${SERVER_PORT}/signal`, {
    //       method: 'POST',
    //       headers: { 'Content-Type': 'application/json' },
    //       body: JSON.stringify({ address: contractAddresses[0], channel: channelUsername }),
    //     });
    //   }
    // }
  } catch (e) {
    console.error(`Error processing message: ${e}`);
  }
}

// Update monitored chats
async function monitorMessages(): Promise<void> {
  MONITORED_CHAT_IDS = [...NEW_MONITORED_CHAT_IDS];
  client.removeEventHandler(processMessages, new NewMessage({}));
  client.addEventHandler(processMessages, new NewMessage({ chats: MONITORED_CHAT_IDS }));
}

// Join a Telegram channel
async function joinChannel(channelName: string): Promise<void> {
  try {

    const result = await client.invoke(
      new Api.channels.JoinChannel({
        channel: "PiAnnouncements",
      })
    );
    console.log("result", result); // prints the result
    
    // const channel = await client.getEntity(channelName);
    // await client.invoke(new ChannelParticipants(channel));
    // const channelId = (channel as any).id.toJSNumber();
    // NEW_MONITORED_CHAT_IDS.push(-1000000000000 - channelId); // Adjust for Telegram's -100 prefix
    // ALL_CHATS.push({ username: (channel as any).username || null, id: -1000000000000 - channelId });
    // console.log(`Detecting Channel list: ${NEW_MONITORED_CHAT_IDS}`);
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
        console.log(`Chat Name: ${entity.username},,${entity.id}`);
        ALL_CHATS.push({ username: entity.username || null, id: -1000000000000 - entity.id.toJSNumber() });
      } catch (e) {
        console.error(`Error: ${e} - ${dialog.title}`);
        continue;
      }
    }

    const documents = await collection.find({}, { projection: { signal: 1, _id: 0 } }).toArray();
    const allSignals: string[] = documents.flatMap((doc) => doc.signal || []);
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

    if (JSON.stringify(NEW_MONITORED_CHAT_IDS) !== JSON.stringify(MONITORED_CHAT_IDS)) {
      await monitorMessages();
    }
    console.log(`MONITORED_CHAT_IDS - ${MONITORED_CHAT_IDS}`);
  } catch (e) {
    console.error(`Error processing data: ${e}`);
  }
}

// Main function to start the client
async function main(): Promise<void> {
  try {
    // Connect to MongoDB
    await mongoClient.connect();
    db = mongoClient.db('MoonBot');
    collection = db.collection('copytrades');
    console.log('Connected to MongoDB');

    // Start the Telegram client
    await client.connect();

    if (!await client.checkAuthorization()){
           const phoneNumber = "+123456789";
           await client.signInUser({
               apiId:API_ID,
               apiHash:API_HASH,
           },{
           phoneNumber: PHONE_NUMBER,
           password: async () => prompt("password?"),
           phoneCode: async () => prompt("Code ?"),
           onError: (err) => console.log(err),
           })
           client.session.save();
           console.log('Session string:', client.session.save());
        }
    console.log('Monitoring chats for pump.fun CAs...');
    // Save session string for future runs

    // Schedule chat monitoring every minute
    scheduleJob('*/1 * * * *', findMonitorChats);
    await joinChannel("dd");

    // Keep the client running
    await new Promise(() => {}); // Prevents immediate exit
  } catch (e) {
    console.error(`Error starting client: ${e}`);
  }
}

// Run the main function
main().catch((err) => console.error(err));

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await client.disconnect();
  await mongoClient.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await client.disconnect();
  await mongoClient.close();
  process.exit(0);
});