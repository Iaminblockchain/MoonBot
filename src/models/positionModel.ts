import mongoose from "mongoose";
import { logger } from "../logger";

export enum PositionStatus {
    OPEN = "OPEN",
    CLOSED = "CLOSED",
}

export interface SellStep {
    priceIncreasement: number; // Percentage increase/decrease from buy price
    sellPercentage: number;    // Cumulative percentage to sell
}

export interface SoldStep {
    priceIncreasement: number; // Actual price increase/decrease when sold
    sellPercentage: number;    // Percentage sold in this step
    soldAmount: number;        // Amount of tokens sold
    soldTime: Date;           // When the tokens were sold
    solAmount: number;        // Amount of SOL received
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
    soldTokenAmount: number; // Amount of tokens sold so far
    soldTokenPercentage: number; // Percentage of tokens sold so far
    sellSteps: SellStep[]; // Array of sell steps with price targets
    soldSteps: SoldStep[]; // Array of completed sell steps
    buyTime: Date;
    status: PositionStatus;
    closeTime?: Date;
    closePriceUsd?: number;
    closePriceSol?: number;
}

const sellStepSchema = new mongoose.Schema({
    priceIncreasement: { type: Number, required: true },
    sellPercentage: { type: Number, required: true }
});

const soldStepSchema = new mongoose.Schema({
    priceIncreasement: { type: Number, required: true },
    sellPercentage: { type: Number, required: true },
    soldAmount: { type: Number, required: true },
    soldTime: { type: Date, required: true },
    solAmount: { type: Number, required: true }
});

const positionSchema = new mongoose.Schema<Position>({
    chatId: { type: String, required: true },
    tokenAddress: { type: String, required: true },
    signalSource: { type: String },
    buyPriceUsd: { type: Number, required: true },
    buyPriceSol: { type: Number, required: true },
    stopLossPercentage: { type: Number, required: true },
    takeProfitPercentage: { type: Number, required: true },
    solAmount: { type: Number, required: true },
    tokenAmount: { type: Number, required: true },
    soldTokenAmount: { type: Number, required: true, default: 0 },
    soldTokenPercentage: { type: Number, required: true, default: 0 },
    sellSteps: { type: [sellStepSchema], required: true, default: [] },
    soldSteps: { type: [soldStepSchema], required: true, default: [] },
    buyTime: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: Object.values(PositionStatus), required: true, default: PositionStatus.OPEN },
    closeTime: { type: Date },
    closePriceUsd: { type: Number },
    closePriceSol: { type: Number },
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
        // Initialize default values for new fields
        const newPosition = new PositionModel({
            ...position,
            status: PositionStatus.OPEN,
            soldTokenAmount: 0,
            soldTokenPercentage: 0,
            soldSteps: [],
            // sellSteps will be set by the caller based on limit orders or stop loss/take profit
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

// Add new helper function to set sell steps based on limit orders or stop loss/take profit
export const setSellSteps = async (
    chatId: string, 
    tokenAddress: string, 
    limitOrders?: { priceIncreasement: number; sellPercentage: number }[],
    stopLossPercentage?: number,
    takeProfitPercentage?: number
) => {
    try {
        let sellSteps: SellStep[] = [];

        if (limitOrders && limitOrders.length > 0) {
            // Add stop loss as first step if provided
            if (stopLossPercentage) {
                sellSteps.push({
                    priceIncreasement: -stopLossPercentage,
                    sellPercentage: 100
                });
            }

            // Add limit orders with cumulative sell percentages
            let cumulativePercentage = 0;
            for (const order of limitOrders) {
                cumulativePercentage += order.sellPercentage;
                sellSteps.push({
                    priceIncreasement: order.priceIncreasement,
                    sellPercentage: cumulativePercentage
                });
            }
        } else {
            // If no limit orders, use stop loss and take profit
            if (stopLossPercentage) {
                sellSteps.push({
                    priceIncreasement: -stopLossPercentage,
                    sellPercentage: 100
                });
            }
            if (takeProfitPercentage) {
                sellSteps.push({
                    priceIncreasement: takeProfitPercentage,
                    sellPercentage: 100
                });
            }
        }

        const result = await PositionModel.updateOne(
            { chatId, tokenAddress },
            { $set: { sellSteps } }
        ).exec();

        logger.info("Sell steps set successfully", { chatId, tokenAddress, sellSteps });
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error("Error setting sell steps", { error, chatId, tokenAddress });
        throw error;
    }
};

// Add helper function to update sold steps
export const addSoldStep = async (
    chatId: string,
    tokenAddress: string,
    soldStep: SoldStep
) => {
    try {
        const position = await PositionModel.findOne({ chatId, tokenAddress });
        if (!position) {
            throw new Error("Position not found");
        }

        // Update sold token amounts
        const newSoldAmount = position.soldTokenAmount + soldStep.soldAmount;
        const newSoldPercentage = (newSoldAmount / position.tokenAmount) * 100;

        const result = await PositionModel.updateOne(
            { chatId, tokenAddress },
            {
                $push: { soldSteps: soldStep },
                $set: {
                    soldTokenAmount: newSoldAmount,
                    soldTokenPercentage: newSoldPercentage,
                    // If all tokens are sold, close the position
                    status: newSoldPercentage >= 100 ? PositionStatus.CLOSED : PositionStatus.OPEN,
                    closeTime: newSoldPercentage >= 100 ? new Date() : undefined
                }
            }
        ).exec();

        logger.info("Sold step added successfully", { chatId, tokenAddress, soldStep });
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error("Error adding sold step", { error, chatId, tokenAddress });
        throw error;
    }
};
