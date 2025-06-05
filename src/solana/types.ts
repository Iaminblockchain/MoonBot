export interface SellStep {
    targetPrice: number;
    sellPercentage: number; // Cumulative percentage
}

export interface SoldStep {
    soldPrice: number;
    soldPercentage: number;
    soldTokenAmount: number;
    soldTime: Date;
}

export type TRADE = {
    contractAddress: string;
    startPrice: number;
    targetPrice: number;
    stopPrice: number;
    totalTokenAmount: number;
    soldTokenAmount: number;
    soldTokenPercentage: number;
    sellSteps: SellStep[];
    soldSteps: SoldStep[];
};
