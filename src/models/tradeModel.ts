import mongoose, { Schema, model, Document } from 'mongoose';
import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../logger';

export interface ITrade extends Document {
    chatId: string;
    tokenAddress: string;
}

const TradeSchema: Schema = new Schema({
    chatId: { type: Number, required: true },
    tokenAddress: { type: String, required: true }
});

export const Trade = model<ITrade>('Trade', TradeSchema);

export const createTrade = async (chatId: TelegramBot.ChatId, tokenAddress: string) => {
    try {
        const trade = new Trade({ chatId, tokenAddress });
        await trade.save();
    } catch (error) {
        logger.error("create trade info: ", { error });
    }
}

export const getTradeByChatId = async (chatId: TelegramBot.ChatId) => {
    try {
        return await Trade.findOne({ chatId }).sort({ _id: -1 });
    } catch (error) {
        return null;
    }
}