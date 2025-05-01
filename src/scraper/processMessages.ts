import { ICall, Call } from "../models/callModel";
import { IChat, Chat } from "../models/chatModel";
import { NewMessageEvent } from "telegram/events";
import { logger } from "../logger";
import { v4 as uuidv4 } from "uuid";
import { getTokenPrice } from "../getPrice";
import { onSignal } from "../controllers/copytradeController";
import { Api } from "telegram";
import { convertChatIdToMTProto } from "../scraper/manageGroups";

// Regex for contract addresses
const PUMP_FUN_CA_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

let totalCAFound = 0;
let totalMessagesRead = 0;

const trackedContracts: Set<string> = new Set();
const groupContractsMap: Record<string, Set<string>> = {};

type MessageLog = {
    title: string | null;
    messageText: string;
    chatIdConverted: string;
    chatId: bigInt.BigInteger;
    chatUsername: string | null;
    date: Date;
};

export let lastMessageLog: MessageLog | null = null;

async function trackPerformance(contractAddress: string, entry_price: string): Promise<void> {
    if (trackedContracts.has(contractAddress)) return;
    trackedContracts.add(contractAddress);

    const intervals = [
        { label: "1m", minutes: 1 },
        { label: "5m", minutes: 5 },
        { label: "15m", minutes: 15 },
        { label: "30m", minutes: 30 },
        { label: "60m", minutes: 60 },
    ];

    for (const { label, minutes } of intervals) {
        setTimeout(
            async () => {
                try {
                    const currentPrice = await getTokenPrice(contractAddress);
                    if (currentPrice && entry_price) {
                        const performance = ((parseFloat(currentPrice) - parseFloat(entry_price)) / parseFloat(entry_price)) * 100;
                        logger.info(`${label} performance for ${contractAddress}: ${performance.toFixed(2)}%`);

                        const updateField = `performance_${label}` as keyof ICall;
                        await Call.findOneAndUpdate({ contract_address: contractAddress }, { [updateField]: performance }, { new: true });
                    } else {
                        logger.warn(`No price available to calculate performance`, { label: label, contractAddress: contractAddress });
                    }
                } catch (err) {
                    logger.error(`Error checking performance for : ${err}`, { label: label, contractAddress: contractAddress });
                }
            },
            minutes * 60 * 1000
        );
    }
}

export async function contractFound(contractAddress: string, chat_id_str: string, chat_username: string): Promise<void> {
    logger.info("process: contract found ", { contractAddress, chat_id_str, chat_username });

    totalCAFound += 1;

    if (!groupContractsMap[chat_username]) {
        groupContractsMap[chat_username] = new Set();
    }
    groupContractsMap[chat_username].add(contractAddress);

    //Track the performance

    let entry_price;
    try {
        entry_price = await getTokenPrice(contractAddress);
        logger.info("process:  price now ", { entry_price: entry_price });
    } catch (err) {
        logger.error("process: error getting price ", { contractAddress: contractAddress });
    }
    if (entry_price) {
        try {
            const callRecord = new Call({
                id: uuidv4(),
                chat_id: chat_id_str,
                contract_address: contractAddress,
                entry_price: entry_price,
                message_date: new Date(),
            });
            await callRecord.save();
            logger.info("process: Saved call record", { chat_id_str: chat_id_str, contractAddress: contractAddress });

            //start tracking
            trackPerformance(contractAddress, entry_price);
        } catch (err) {
            logger.error(`Error saving call record: ${err}`);
        }
    } else {
        logger.error("no entry price");
    }

    //call copy trade
    logger.info("process: onSignal " + chat_id_str);

    await onSignal(chat_id_str, contractAddress);
}

export async function processMessages(event: NewMessageEvent): Promise<void> {
    try {

        const messageDate = event.message.date;
        if (!messageDate) {
            logger.error("Skipping message, message date is not available");
            return
        }
        const date = new Date(messageDate * 1000)

        // First check that the message sender is a Api.User or Api.Channel
        // users that send a message in their own channel take on the chat id of the channel.
        // We ignore Api.Chat because users in a Chat will be an Api.User sender.
        const sender = event.message.sender;
        if (!(sender instanceof Api.User || sender instanceof Api.Channel)) {
            const senderType = sender ? sender.className : "undefined";
            logger.info("Skipping message, sender was not an instance of Api.User or Api.Channel", { senderType: senderType });
            return;
        }

        const messageText = event.message.text || "";
        if (messageText == "") {
            logger.info("Skipping message, message was empty");
            return;
        }

        // Not using event.message.senderId;
        const chatId = event.message.chatId;

        if (!chatId) {
            logger.info("Skipping message, event.message.chatId doesn't exist");
            return;
        }

        if (!event.client) {
            logger.info("Skipping message, event.client doesn't exist");
            return;
        }

        // Convert chatId to BOT Chat Id format
        let chatIdConverted = String(chatId);
        chatIdConverted = convertChatIdToMTProto(chatIdConverted);

        // Get direct channel username if available
        let channelUsername = null;
        if (sender instanceof Api.Channel) {
            channelUsername = sender.username || null;
        } else if (event.message.chat instanceof Api.Channel) {
            channelUsername = event.message.chat.username || null;
        } else {
            logger.info(`No username available (sender is not a Channel and chat is not a Channel/Supergroup)`);
        }

        // Either Channel title or Chat title
        let title: string | null = null;
        try {
            if (sender instanceof Api.Channel) {
                logger.debug("Message was sent from an Api.Channel");
                title = sender.title;
            } else if (event.message.chat instanceof Api.Chat) {
                logger.debug("Message was sent from a Chat/Group");
                title = event.message.chat.title || null;
            } else if (event.message.chat instanceof Api.Channel) {
                logger.debug("Message was sent from a Supergroup");
                title = event.message.chat.title || null;
            } else {
                logger.warn("Unable to get title of message source", {
                    senderType: sender?.constructor?.name,
                    chatType: event.message.chat?.constructor?.name,
                    messageId: event.message.id,
                    chatId: event.message.chatId,
                });
            }
        } catch (error) {
            logger.error("Error extracting title from message", {
                error: error instanceof Error ? error.message : String(error),
                errorType: error?.constructor?.name,
                senderType: sender?.constructor?.name,
                chatType: event.message.chat?.constructor?.name,
                messageId: event.message.id,
                chatId: event.message.chatId,
            });
            title = null;
        }

        lastMessageLog = {
            title: title,
            messageText: messageText,
            chatIdConverted: chatIdConverted,
            chatId: chatId,
            chatUsername: channelUsername,
            date: date,
        };

        // Log message info
        logger.info(`Incoming message ${channelUsername}`, lastMessageLog);

        // Query database for the chat username info
        const chatDoc = await Chat.findOne({ chat_id: chatIdConverted });
        // TODO: Don't use "N/A" as a default value
        const chatUsername = chatDoc?.username || "N/A";

        // Update stats
        totalMessagesRead++;
        logger.info("Current stats", {
            totalMessages: totalMessagesRead,
            totalContractAddressesFound: totalCAFound,
        });

        //every 10 messages log contracts per group
        if (totalMessagesRead % 10 == 0) {
            const summary: Record<string, string[]> = {};
            for (const [group, contracts] of Object.entries(groupContractsMap)) {
                summary[group] = Array.from(contracts);
            }
            logger.info("1-minute contract summary", { summary });
        }

        // Detect contract address
        const contractAddresses = messageText.match(PUMP_FUN_CA_REGEX) || [];
        if (contractAddresses.length > 0) {
            const contractAddress = contractAddresses[0] || "";
            logger.info(`Detected contract address ${contractAddress} from ${chatUsername}`, {
                contractAddress: contractAddress,
                chatId: chatIdConverted,
                chat_username: chatUsername,
            });
            await contractFound(contractAddress, chatIdConverted, chatUsername);
        }
    } catch (e) {
        logger.error("Error processing message", { error: e });
    }
}
