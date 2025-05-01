import mongoose from "mongoose";
import { logger } from "../logger";

export enum PositionStatus {
    OPEN = "OPEN",
    CLOSED = "CLOSED"
}

export interface Position {
    chatId: string;
    tokenAddress: string;
    signalSource?: string; // For copy trading
    buyPrice: number;
    stopLossPercentage: number; // Percentage from buy price
    takeProfitPercentage: number; // Percentage from buy price
    solAmount: number;
    tokenAmount: number;
    buyTime: Date;
    status: PositionStatus;
    closeTime?: Date;
    closePrice?: number;
}

const positionSchema = new mongoose.Schema<Position>({
    chatId: { type: String, required: true },
    tokenAddress: { type: String, required: true },
    signalSource: { type: String },
    buyPrice: { type: Number, required: true },
    stopLossPercentage: { type: Number, required: true }, // Stored as percentage (e.g., 5 for 5%)
    takeProfitPercentage: { type: Number, required: true }, // Stored as percentage (e.g., 10 for 10%)
    solAmount: { type: Number, required: true },
    tokenAmount: { type: Number, required: true },
    buyTime: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: Object.values(PositionStatus), required: true, default: PositionStatus.OPEN },
    closeTime: { type: Date },
    closePrice: { type: Number }
});

export const PositionModel = mongoose.model<Position>("Position", positionSchema);

// Helper functions to calculate actual prices from percentages
export const calculateStopLossPrice = (buyPrice: number, stopLossPercentage: number) => {
    return buyPrice * (1 - stopLossPercentage / 100);
};

export const calculateTakeProfitPrice = (buyPrice: number, takeProfitPercentage: number) => {
    return buyPrice * (1 + takeProfitPercentage / 100);
};

// Helper function to calculate token amount considering decimals
export const calculateTokenAmount = (solAmount: number, buyPrice: number, tokenDecimals: number) => {
    // Convert SOL amount to token amount
    const tokenAmount = solAmount / buyPrice;
    // Adjust for token decimals (e.g., if token has 9 decimals, multiply by 10^9)
    return tokenAmount * Math.pow(10, tokenDecimals);
};

export const createPosition = async (position: Position) => {
    try {
        const newPosition = new PositionModel({
            ...position,
            status: PositionStatus.OPEN
        });
        const result = await newPosition.save();
        logger.info("Position created successfully", { positionId: result._id });
        return result._id;
    } catch (error) {
        logger.error("Error creating position", { error });
        throw error;
    }
};

export const closePosition = async (chatId: string, tokenAddress: string, closePrice: number) => {
    try {
        const result = await PositionModel.updateOne(
            { chatId, tokenAddress, status: PositionStatus.OPEN },
            { 
                $set: { 
                    status: PositionStatus.CLOSED,
                    closeTime: new Date(),
                    closePrice: closePrice
                }
            }
        ).exec();
        logger.info("Position closed successfully", { chatId, tokenAddress, closePrice });
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error("Error closing position", { error, chatId, tokenAddress });
        throw error;
    }
};

export const getPositionsByChatId = async (chatId: string) => {
    try {
        return await PositionModel.find({ chatId }).exec();
    } catch (error) {
        logger.error("Error getting positions by chatId", { error, chatId });
        throw error;
    }
};

export const getPositionByTokenAddress = async (chatId: string, tokenAddress: string) => {
    try {
        return await PositionModel.findOne({ chatId, tokenAddress }).exec();
    } catch (error) {
        logger.error("Error getting position by token address", { error, chatId, tokenAddress });
        throw error;
    }
};

export const updatePosition = async (chatId: string, tokenAddress: string, updates: Partial<Position>) => {
    try {
        const result = await PositionModel.updateOne(
            { chatId, tokenAddress },
            { $set: updates }
        ).exec();
        logger.info("Position updated successfully", { chatId, tokenAddress, updates });
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error("Error updating position", { error, chatId, tokenAddress });
        throw error;
    }
};

export const deletePosition = async (chatId: string, tokenAddress: string) => {
    try {
        const result = await PositionModel.deleteOne({ chatId, tokenAddress }).exec();
        logger.info("Position deleted successfully", { chatId, tokenAddress });
        return result.deletedCount > 0;
    } catch (error) {
        logger.error("Error deleting position", { error, chatId, tokenAddress });
        throw error;
    }
}; 