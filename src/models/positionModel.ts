import mongoose from "mongoose";
import { logger } from "../logger";

export enum PositionStatus {
    OPEN = "OPEN",
    CLOSED = "CLOSED",
}

export interface SellStep {
    priceIncreasement: number;  // Percentage increase from buy price
    sellPercentage: number;     // Percentage of tokens to sell at this step
}

export interface SoldStep {
    soldPrice: number;          // Price at which the tokens were sold
    sellPercentage: number;     // Percentage of tokens that were sold
    solAmount: number;          // Amount of SOL received from the sale
}

export interface Position {
    chatId: string;
    tokenAddress: string;
    signalSource?: string; // For copy trading
    buyPriceUsd: number;
    buyPriceSol: number;
    stopLossPercentage: number; // Percentage from buy price
    takeProfitPercentage: number; // Percentage from buy price
    solAmount: number;
    tokenAmount: number; // Amount of tokens purchased
    buyTime: Date;
    status: PositionStatus;
    closeTime?: Date;
    closePriceUsd?: number;
    closePriceSol?: number;
    sellSteps: SellStep[];      // Array of sell steps for limit orders
    soldSteps: SoldStep[];      // Array of completed sell steps
}

const positionSchema = new mongoose.Schema<Position>({
    chatId: { type: String, required: true },
    tokenAddress: { type: String, required: true },
    signalSource: { type: String },
    buyPriceUsd: { type: Number, required: true },
    buyPriceSol: { type: Number, required: true },
    stopLossPercentage: { type: Number, required: true }, // Stored as percentage (e.g., 5 for 5%)
    takeProfitPercentage: { type: Number, required: true }, // Stored as percentage (e.g., 10 for 10%)
    solAmount: { type: Number, required: true },
    tokenAmount: { type: Number, required: true }, // Amount of tokens purchased
    buyTime: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: Object.values(PositionStatus), required: true, default: PositionStatus.OPEN },
    closeTime: { type: Date },
    closePriceUsd: { type: Number },
    closePriceSol: { type: Number },
    sellSteps: [{
        priceIncreasement: { type: Number, required: true },
        sellPercentage: { type: Number, required: true }
    }],
    soldSteps: [{
        soldPrice: { type: Number, required: true },
        sellPercentage: { type: Number, required: true },
        solAmount: { type: Number, required: true }
    }]
});

export const PositionModel = mongoose.model<Position>("Position", positionSchema);

// Helper functions to calculate actual prices from percentages
export const calculateStopLossPrice = (buyPrice: number, stopLossPercentage: number) => {
    return buyPrice * (1 - stopLossPercentage / 100);
};

export const calculateTakeProfitPrice = (buyPrice: number, takeProfitPercentage: number) => {
    return buyPrice * (1 + takeProfitPercentage / 100);
};

export const createPosition = async (position: Position) => {
    try {
        // Always create a new position
        const newPosition = new PositionModel({
            ...position,
            status: PositionStatus.OPEN,
        });
        const result = await newPosition.save();
        logger.info("Position created successfully", { positionId: result._id });
        return result._id;
    } catch (error) {
        logger.error("Error creating position", { error });
        throw error;
    }
};

export const closePosition = async (chatId: string, tokenAddress: string, closePriceUsd: number, closePriceSol: number) => {
    try {
        const result = await PositionModel.updateOne(
            { chatId, tokenAddress, status: PositionStatus.OPEN },
            {
                $set: {
                    status: PositionStatus.CLOSED,
                    closeTime: new Date(),
                    closePriceUsd: closePriceUsd,
                    closePriceSol: closePriceSol,
                },
            }
        ).exec();
        logger.info("Position closed successfully", { chatId, tokenAddress, closePriceUsd, closePriceSol });
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
        const result = await PositionModel.updateOne({ chatId, tokenAddress }, { $set: updates }).exec();
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
