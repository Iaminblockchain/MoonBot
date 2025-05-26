export type SellStep = {
    targetPrice: number;
    sellPercentage: number;
};

export type SoldStep = {
    soldPrice: number;
    percentage: number;
    solAmount: number;
};

export type TRADE = {
    contractAddress: string;
    startPrice: number;
    targetPrice: number;
    stopPrice: number;
    amount: number;
    registrationTime?: number; // Timestamp when the trade was registered
    soldTokenAmount: number;
    soldTokenPercentage: number;
    sellSteps: SellStep[];
    soldSteps: SoldStep[];
};
