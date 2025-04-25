import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import { retrieveEnvVariable } from "../config";
import { logger } from "../util";
import mongoose from 'mongoose';
import { TELEGRAM_STRING_SESSION, TELEGRAM_API_ID, TELEGRAM_API_HASH } from "../index";
import { Trade, getTradeByChatId } from '../models/copyTradeModel';


const MONGO_URI = retrieveEnvVariable("mongo_url");
import { Chat } from '../models/chatModel';
import { Call } from '../models/callModel';

const session = new StringSession(TELEGRAM_STRING_SESSION);
//const session = new StringSession('');
logger.info('login with ' + session + ' ' + TELEGRAM_API_ID + ' ' + TELEGRAM_API_HASH);
let client = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, {
    connectionRetries: 5,
});

async function listChannelsDB(): Promise<void> {
    try {
        await mongoose.connect(MONGO_URI);
        logger.info('MongoDB connected');

        const chats = await Chat.find({});
        if (chats.length === 0) {
            logger.info('No chats found in database.');
        } else {
            logger.info(`Found ${chats.length} chats:`);
            for (const chat of chats) {
                logger.info(`ID: ${chat.id}, Chat ID: ${chat.chat_id}`);
            }
        }

        process.exit(0);
    } catch (error) {
        logger.error('Error listing channels from DB', error);
        process.exit(1);
    }
}

async function listCallsDB(): Promise<void> {
    try {
        await mongoose.connect(MONGO_URI);
        logger.info('MongoDB connected');

        const calls = await Call.find({});
        if (calls.length === 0) {
            logger.info('No calls found in database.');
        } else {
            logger.info(`Found ${calls.length} calls:`);
            for (const chat of calls) {
                logger.info(`ID: ${chat.id}, calls ID: ${chat.chat_id}`);
            }
        }

        process.exit(0);
    } catch (error) {
        logger.error('Error listing channels from DB', error);
        process.exit(1);
    }
}

export const getAllTrades = async () => {
    try {
        return await Trade.find({}).sort({ _id: -1 });
    } catch (error) {
        logger.error("Error fetching all trades", error);
        return [];
    }
};

(async () => {
    await client.connect();
    //await listChannelsDB();
    //await listCallsDB();
    //await listUserChannels();

    const allTrades = await getAllTrades();
    allTrades.forEach(trade => {
        logger.info(`ChatID: ${trade.chatId}, Signal: ${trade.signal}`);
    });
})();