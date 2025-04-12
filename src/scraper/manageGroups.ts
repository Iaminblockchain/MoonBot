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

export async function joinChannelByName(client: TelegramClient, name: string, dialogs: Dialog[]): Promise<void> {
    const channelName = name.replace("https://t.me/", "").replace("@", "").toLowerCase();
    logger.info("joinChannelByName " + channelName);

    const entity = await client.getEntity(channelName);

    if (!(entity instanceof Api.Channel)) {
        logger.warn(`⚠️ Skipping ${channelName}: not a channel (got ${entity.className})`);
        return;
    }

    const channelId = entity.id;

    const alreadyJoined = dialogs.some(dialog => {
        const dialogEntity = dialog.entity;
        return dialogEntity instanceof Api.Channel && dialogEntity.id.equals?.(channelId);
    });

    if (alreadyJoined) {
        logger.info(`⚠️ Already joined: ${channelName}`);
        return;
    }
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {

            const result: any = await client.invoke(
                new Api.channels.JoinChannel({ channel: entity })
            );

            const channel = result?.chats?.[0] as Api.Channel;
            if (!channel) throw new Error("Join failed: no channel returned");

            logger.info(`✅ Successfully joined channel: ${channel.title} (${channel.id})`);
            return;
        } catch (e: any) {
            const floodMatch = e.message?.match(/wait of (\d+) seconds/);

            if (floodMatch && attempt < MAX_RETRIES) {
                const waitSeconds = parseInt(floodMatch[1], 10);
                logger.warn(`⏳ Flood wait (${waitSeconds}s) on attempt ${attempt} for ${channelName}. Retrying...`);
                await delay(waitSeconds * 1000);
            } else {
                logger.error(`❌ joinChannelByName failed for ${channelName} (attempt ${attempt}): ${e?.message || e}`);
                break;
            }
        }
    }

    logger.error(`❌ Max retry attempts reached or unrecoverable error for ${channelName}.`);
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