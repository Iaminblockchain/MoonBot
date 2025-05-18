import mongoose, { Schema, model, Document } from "mongoose";
import TelegramBot from "node-telegram-bot-api";
import { logger } from "../logger";

export interface LimitOrderStep {
    stepNumber: number;
    sellPercentage: number;
    priceIncrement: number;
}

export interface ITrade extends Document {
    chatId: string;
    tag: string | null;
    signal: string;
    signalChatId: string;
    amount: number;
    maxSlippage: number;
    tp: number;
    sl: number;
    repetitiveBuy: number;
    active: boolean;
    limitOrder: boolean;
    limitOrderActive: boolean;
    limitOrderSteps: LimitOrderStep[];
}

const TradeSchema: Schema = new Schema({
    chatId: { type: String, required: true },
    tag: { type: String, default: "", nullable: true },
    signal: { type: String, default: "" },
    signalChatId: { type: String, default: null, nullable: true },
    amount: { type: Number, default: 0 },
    maxSlippage: { type: Number, default: 5 },
    tp: { type: Number, default: null },
    sl: { type: Number, default: null },
    repetitiveBuy: { type: Number, default: 1 },
    active: { type: Boolean, default: false },
    limitOrder: { type: Boolean, default: false },
    limitOrderActive: { type: Boolean, default: false },
    limitOrderSteps: [{
        stepNumber: { type: Number, required: true },
        sellPercentage: { type: Number, required: true },
        priceIncrement: { type: Number, required: true }
    }]
});

// TradeSchema.index({ chatId: 1, signal: 1 }, { unique: true });

export const Trade = model<ITrade>("copytrade", TradeSchema);

export const addTrade = async (chatId: TelegramBot.ChatId) => {
    try {
        const trade = await Trade.create({ chatId });
        return trade;
    } catch (error) {
        logger.error("Add Copy Trade Error", error);
    }
};

export const removeTrade = async (props: { _id?: mongoose.Types.ObjectId }) => {
    try {
        await Trade.findOneAndDelete(props);
        return true;
    } catch (error) {
        logger.error("Remove Copy Trade Error", error);
        return false;
    }
};

export const updateTrade = async (props: { id: mongoose.Types.ObjectId | string } & Partial<ITrade>) => {
    try {
        logger.info("updateTrade " + JSON.stringify(props));
        const { id } = props;
        let copytrade = await Trade.findByIdAndUpdate(id, props);
        return copytrade;
    } catch (error) {
        logger.error("Update Copy Trade Error", error);
    }
};

export const findAndUpdateOne = async (filter: mongoose.FilterQuery<ITrade>, props: mongoose.UpdateQuery<ITrade>) => {
    try {
        const result = await Trade.findOneAndUpdate(filter, props, { new: true, upsert: false });
        return result;
    } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : "Unknown error");
    }
};

export const findTrade = async (props: mongoose.FilterQuery<ITrade>) => {
    try {
        let copytrade = await Trade.findOne(props);
        return copytrade;
    } catch (error) {
        logger.error("Find Copy Trade Error", error);
    }
};

export const getTradeByChatId = async (chatId: TelegramBot.ChatId) => {
    try {
        const copytrade = await Trade.find({ chatId });
        return copytrade;
    } catch (error) {
        logger.error("Error", error);
        return [];
    }
};

export const getChatIdByChannel = async (sig: string) => {
    try {
        const signal = extractAddress(sig.trim());
        const tradesWithSignal = await Trade.find({ signal: signal });
        const chatIds = tradesWithSignal.map((trade) => trade.chatId);
        return chatIds;
    } catch (error) {
        logger.error("Error", error);
        return [];
    }
};

export const getAllActiveChannels = async () => {
    try {
        const tradesWithSignal = await Trade.find({ active: true });
        const signals = tradesWithSignal.map((trade) => trade.signal);
        return signals;
    } catch (error) {
        logger.error("Error", error);
        return [];
    }
};

export const extractAddress = (input: string) => {
    if (input.startsWith("https://t.me/")) {
        return input.substring(input.lastIndexOf("/") + 1);
    } else if (input.startsWith("@")) {
        return input.substring(1);
    } else if (input.endsWith("%")) {
        return input.slice(0, -1);
    }
    return input;
};
