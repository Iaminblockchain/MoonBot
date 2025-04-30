import mongoose, { Schema, model, Document } from "mongoose";
import TelegramBot from "node-telegram-bot-api";
import { logger } from "../logger";

export interface IWallet extends Document {
    chatId: string;
    privateKey: string;
}

const WalletSchema: Schema = new Schema({
    chatId: { type: Number, required: true },
    privateKey: { type: String, required: true, unique: true },
});

export const Wallet = model<IWallet>("Wallet", WalletSchema);

export const getWalletByChatId = async (chatId: TelegramBot.ChatId) => {
    try {
        return await Wallet.findOne({ chatId });
    } catch (error) {
        return null;
    }
};

export const createWallet = async (chatId: TelegramBot.ChatId, privateKey: string) => {
    try {
        const wallet = new Wallet({ chatId, privateKey });
        await wallet.save();
    } catch (error) {
        logger.error("Error creating wallet:", { error });
    }
};

// Function to get chatId by privateKey
export const getChatIdByPrivateKey = async (privateKey: string): Promise<string | null> => {
    try {
        const wallet = await Wallet.findOne({ privateKey });
        return wallet ? wallet.chatId : null;
    } catch (error) {
        logger.error("Error fetching chatId by privateKey:", { error });
        return null;
    }
};
