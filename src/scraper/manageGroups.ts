// manage groups
import { Api, TelegramClient } from "telegram";
import { logger } from "../logger";
import { Dialog } from "telegram/tl/custom/dialog";
import { Chat } from "../models/chatModel";
import { getTgClient } from "./scraper";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRY_ATTEMPTS = 3;

export async function joinChannel(client: TelegramClient, chatId: string, cachedDialogs: Dialog[] | null): Promise<void> {
    logger.info("joinChannel " + chatId);

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
        try {
            const result = await client.invoke(new Api.channels.JoinChannel({ channel: chatId }));

            // Type assertion to fix the property access error
            const typedResult = result as { chats?: Api.Channel[] };
            const channel = typedResult?.chats?.[0] as Api.Channel;
            if (!channel) {
                throw new Error("Channel join failed, no channel returned");
            }

            logger.info("joined " + result);
            return;
        } catch (e: unknown) {
            const errorMessage = (e as Error).message || "";
            const floodMatch = errorMessage.match(/wait of (\d+) seconds/);

            if (floodMatch && attempt < MAX_RETRY_ATTEMPTS - 1) {
                const waitSeconds = parseInt(floodMatch[1], 10);
                logger.info(`Flood wait detected. Waiting for ${waitSeconds} seconds before retrying join for ${chatId}.`);
                await delay(waitSeconds * 1000);
            } else {
                logger.error(`joinChannel Error (attempt ${attempt + 1}): ${e}`);
                break;
            }
        }
    }

    logger.error(`Max retry attempts reached or unrecoverable error for channel ${chatId}.`);
}

export async function joinChannelByName(
    client: TelegramClient,
    name: string,
    dialogs: Dialog[]
): Promise<{ id: string | null; success: boolean }> {
    const channelName = name.replace("https://t.me/", "").replace("@", "").toLowerCase();
    logger.info("joinChannelByName " + channelName);

    const entity = await client.getEntity(channelName);

    if (!(entity instanceof Api.Channel)) {
        logger.warn(`⚠️ Skipping ${channelName}: not a channel (got ${entity.className})`);
        return { id: null, success: false };
    }

    const channelId = entity.id;
    const alreadyJoined = dialogs.some((dialog) => {
        const dialogEntity = dialog.entity;
        return dialogEntity instanceof Api.Channel && dialogEntity.id.equals?.(channelId);
    });

    if (alreadyJoined) {
        logger.info(`⚠️ Already joined: ${channelName} channelId ${channelId}`);
        return { id: channelId.toString(), success: true };
    }

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await client.invoke(new Api.channels.JoinChannel({ channel: entity }));

            // Type assertion for result
            const typedResult = result as { chats?: Api.Channel[] };
            const channel = typedResult?.chats?.[0] as Api.Channel;
            if (!channel) throw new Error("Join failed: no channel returned");

            logger.info(`✅ Successfully joined channel: ${channel.title} (${channel.id})`);
            return { id: channel.id.toString(), success: true };
        } catch (e: unknown) {
            const errorMessage = (e as Error).message || "";
            const floodMatch = errorMessage.match(/wait of (\d+) seconds/);

            if (floodMatch && attempt < MAX_RETRIES) {
                const waitSeconds = parseInt(floodMatch[1], 10);
                logger.warn(`⏳ Flood wait (${waitSeconds}s) on attempt ${attempt} for ${channelName}. Retrying...`);
                await delay(waitSeconds * 1000);
            } else {
                logger.error(`❌ joinChannelByName failed for ${channelName} (attempt ${attempt}): ${errorMessage}`);
                break;
            }
        }
    }

    logger.error(`❌ Max retry attempts reached or unrecoverable error for ${channelName}.`);
    return { id: null, success: false };
}

export async function joinChannelsDB(client: TelegramClient): Promise<void> {
    logger.info("joinChannelsDB");

    try {
        const dialogs = await client.getDialogs({});
        const dbChats = await Chat.find({}, "username chat_id");

        for (const chat of dbChats) {
            if (chat.username) {
                logger.info(`🔍 Checking and attempting to join: ${chat.username}`);
                await joinChannelByName(client, chat.username, dialogs);
            } else {
                logger.error(`❌ Missing username for chat_id: ${chat.chat_id}`);
            }
        }
    } catch (error) {
        logger.error(`Failed to join predefined channels: ${error}`);
    }
}

export function convertChatIdToMTProto(chat_id_str: string): string {
    //convert id, more info https://core.telegram.org/api/bots/ids
    let chat_id_num = BigInt(chat_id_str);

    if (chat_id_num >= BigInt("-2002147483648") && chat_id_num <= BigInt("-1997852516353")) {
        // Secret chat
        chat_id_num = chat_id_num - BigInt("2000000000000");
    } else if (chat_id_num >= BigInt("-1997852516352") && chat_id_num <= BigInt("-1000000000001")) {
        // Supergroup/channel
        chat_id_num = -chat_id_num - BigInt("1000000000000");
    } else if (chat_id_num >= BigInt("-999999999999") && chat_id_num <= BigInt("-1")) {
        // Basic group
        chat_id_num = -chat_id_num;
    }
    return chat_id_num.toString();
}
