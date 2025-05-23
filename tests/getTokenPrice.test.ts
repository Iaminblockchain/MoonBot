import { getTokenPriceUSD, getTokenPriceBatch } from "../src/solana/getPrice";

describe("getTokenPriceUSD", () => {
    it("should fetch and return token price", async () => {
        const tokenAddress = "So11111111111111111111111111111111111111112";

        const price = await getTokenPriceUSD(tokenAddress);

        expect(price).toBeGreaterThan(0);
    });

    it("should fetch price for another token", async () => {
        const tokenAddress = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
        const price = await getTokenPriceUSD(tokenAddress);

        expect(price).toBeGreaterThan(0);
    });
});

describe("getTokenPriceBatch", () => {
    it("should fetch prices for multiple tokens", async () => {
        const tokenAddresses = [
            "So11111111111111111111111111111111111111112", // WSOL
            "Ey59PH7Z4BFU4HjyKnyMdWt5GGN76KazTAwQihoUXRnk", // BONK
        ];

        const prices = await getTokenPriceBatch(tokenAddresses);

        // Check if we got prices for all tokens
        expect(prices.size).toBe(2);

        // Check if prices are valid numbers greater than 0
        for (const [token, price] of prices) {
            expect(price).toBeGreaterThan(0.0001);
            expect(typeof price).toBe("number");
        }
    });

    it("should handle empty array input", async () => {
        const prices = await getTokenPriceBatch([]);
        expect(prices.size).toBe(0);
    });

    it("should handle invalid token addresses gracefully", async () => {
        const tokenAddresses = [
            "So11111111111111111111111111111111111111112", // Valid WSOL
            "invalid_token_address", // Invalid address
        ];

        const prices = await getTokenPriceBatch(tokenAddresses);

        //console.log(prices);

        // Should still get price for valid token
        expect(prices.size).toBe(1);
        expect(prices.get("So11111111111111111111111111111111111111112")).toBeGreaterThan(0);
    });
});
