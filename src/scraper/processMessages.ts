// telegramUtils.ts

import { Chat } from "../models/chatModel";
import { Call } from "../models/callModel";
import { NewMessageEvent } from "telegram/events";
import { logger } from '../util';
import { ScrapeStats } from "../models/scrapeStats";
//import { onSignal } from "../controllers/copytradeController";

// Regex for contract addresses
const PUMP_FUN_CA_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

// To store some state variables if needed
const uniqueIncomingChannelIds: Set<number> = new Set();
let totalContractAddressesFound = 0;
let totalMessagesRead = 0;


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
                total_messages_read: totalMessagesRead,
                unique_channel_count: uniqueIncomingChannelIds.size,
                contracts_found: totalContractAddressesFound,
            },
            { upsert: true, new: true }
        );
        logger.info('Scrape stats updated in DB');
    } catch (error) {
        logger.error("Failed to update scrape_stats", error);
    }
}

// `contractFound` function
export async function contractFound(
    channelUsername: string | null,
    contractAddresses: string[],
    channelId: number
): Promise<void> {
    // Original implementation...
}

// Process incoming messages
export async function processMessages(event: NewMessageEvent): Promise<void> {

    const messageText = event.message.text;
    if (messageText == '') return;

    const channelId = event.message.senderId;
    //channel id can be empty
    //if (!channelId) return;
    //const id = -(channelId.toJSNumber() % 10000000000);
    //uniqueIncomingChannelIds.add(id);    
    logger.info("message " + messageText + " " + channelId);

    totalMessagesRead++;
    logger.info("total messages " + totalMessagesRead);
}

