// manage groups
import { Api, TelegramClient } from "telegram";
import { logger } from '../util';
import { Dialog } from "telegram/tl/custom/dialog";
import { Chat } from "../models/chatModel";
import { getTgClient } from "./scraper";

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RETRY_ATTEMPTS = 3;

export async function joinChannel(
    client: TelegramClient,
    chatId: string,
    cachedDialogs: Dialog[] | null
): Promise<void> {
    logger.info("joinChannel " + chatId);

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
        try {
            const result: any = await client.invoke(
                new Api.channels.JoinChannel({ channel: chatId })
            );

            const channel = result?.chats && result.chats[0] as Api.Channel;
            if (!channel) {
                throw new Error("Channel join failed, no channel returned");
            }

            logger.info('joined ' + result);
            return;
        } catch (e: any) {
            const floodMatch = e.message?.match(/wait of (\d+) seconds/);

            if (floodMatch && attempt < MAX_RETRY_ATTEMPTS - 1) {
                const waitSeconds = parseInt(floodMatch[1], 10);
                logger.info(
                    `Flood wait detected. Waiting for ${waitSeconds} seconds before retrying join for ${chatId}.`
                );
                await delay(waitSeconds * 1000);
            } else {
                logger.error(`joinChannel Error (attempt ${attempt + 1}): ${e}`);
                break;
            }
        }
    }

    logger.error(`Max retry attempts reached or unrecoverable error for channel ${chatId}.`);
}

export async function joinChannelsDB(client: TelegramClient): Promise<void> {
    logger.info("joinChannelsDB");
    try {

        // Fetch predefined chats from the database
        const dbChats = await Chat.find({}, 'chat_id');

        // Get currently cached dialogs
        const cachedDialogs = await client.getDialogs({});

        // Iterate through each chat entry and attempt to join the channel
        for (const chat of dbChats) {
            const chatid = chat.chat_id;

            // Assuming channel_id here is equivalent to channelName in your context
            if (chatid) {
                logger.info(`Attempting to join chat with ID: ${chatid}`);
                await joinChannel(client, chatid, cachedDialogs);
            } else {
                logger.warn(`No chatid found for chat: ${chat}`);
            }
        }
    } catch (error) {
        logger.error(`Failed to join predefined channels: ${error}`);
    }
}

