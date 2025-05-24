export type TRADE = {
    contractAddress: string;
    startPrice: number;
    targetPrice: number;
    stopPrice: number;
    amount: number;
    registrationTime?: number; // Timestamp when the trade was registered
};
