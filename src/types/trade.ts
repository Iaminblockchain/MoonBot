import { SellStep, SoldStep } from "../models/positionModel";

export type TRADE = {
    contractAddress: string;
    startPrice: number;
    targetPrice: number;
    stopPrice: number;
    amount: number;
    registrationTime?: number; // Timestamp when the trade was registered
    soldTokenAmount?: number;  // Amount of tokens sold
    soldTokenPercentage?: number; // Percentage of tokens sold
    sellSteps: SellStep[];     // Array of sell steps for limit orders
    soldSteps: SoldStep[];     // Array of completed sell steps
};
