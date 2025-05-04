import mongoose, { Schema, model, Document } from "mongoose";
import TelegramBot from "node-telegram-bot-api";
import { logger } from "../logger";

export interface IWallet extends Document {
    chatId: string;
    privateKey: string;
    referralWallet: string | null; // Private key of the referral wallet
}

const WalletSchema: Schema = new Schema({
    chatId: { type: Number, required: true },
    privateKey: { type: String, required: true, unique: true },
    referralWallet: { type: String, default: null }, // Store referral wallet's private key
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

// Function to update referral wallet
export const updateReferralWallet = async (chatId: TelegramBot.ChatId, privateKey: string): Promise<boolean> => {
    try {
        await Wallet.findOneAndUpdate({ chatId }, { referralWallet: privateKey }, { new: true });
        return true;
    } catch (error) {
        logger.error("Error updating referral wallet:", { error });
        return false;
    }
};

// Function to get referral wallet
export const getReferralWallet = async (chatId: TelegramBot.ChatId) => {
    try {
        const wallet = await Wallet.findOne({ chatId });
        return wallet?.referralWallet || null;
    } catch (error) {
        logger.error("Error getting referral wallet:", { error });
        return null;
    }
};
