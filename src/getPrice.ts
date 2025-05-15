import axios from "axios";
import { logger } from "./logger";

const BASE_URL = "https://lite-api.jup.ag/price/v2";
const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";

export async function getTokenPrice(ids: string, vsToken: string | null = null, showExtraInfo: boolean = false): Promise<number> {
    try {
        // Construct URL with ids as a query parameter
        let url = `${BASE_URL}?ids=${encodeURIComponent(ids)}`;

        // Add optional parameters if needed
        if (showExtraInfo) {
            url += `&showExtraInfo=true`;
        } else if (vsToken) {
            url += `&vsToken=${encodeURIComponent(vsToken)}`;
        }

        const response = await axios.get(url);

        const priceData = response.data.data;

        // Extracting details
        for (const tokenId in priceData) {
            if (priceData.hasOwnProperty(tokenId)) {
                const tokenInfo = priceData[tokenId];
                const price = Number(tokenInfo.price);

                if (isNaN(price)) {
                    throw new Error(`Invalid price for token ${tokenId}`);
                }

                logger.debug("Price ", { token: tokenInfo.id, price });
                return price;
            }
        }

        // If no price is found, throw an error
        throw new Error(`No price found for token(s): ${ids}`);
    } catch (error) {
        logger.error("Error fetching price:", error);
        throw error;
    }
}

/**
 * Fetches prices for multiple tokens in a single API call
 * @param ids Array of token addresses to fetch prices for
 * @returns Map of token addresses to their prices in WSOL
 */
export async function getTokenPriceBatch(ids: string[]): Promise<Map<string, number>> {
    try {
        if (ids.length === 0) {
            return new Map();
        }

        // Join all token IDs with commas
        const idsString = ids.join(",");
        const url = `${BASE_URL}?ids=${encodeURIComponent(idsString)}&vsToken=${WSOL_ADDRESS}`;

        const response = await axios.get(url);
        const priceData = response.data.data;
        const priceMap = new Map<string, number>();

        // Process each token's price data
        for (const tokenId in priceData) {
            if (priceData.hasOwnProperty(tokenId)) {
                const tokenInfo = priceData[tokenId];

                // Skip if tokenInfo is null or doesn't have price
                if (!tokenInfo || typeof tokenInfo.price === "undefined") {
                    logger.warn(`No price data for token ${tokenId}`);
                    continue;
                }

                const price = Number(tokenInfo.price);

                if (isNaN(price)) {
                    logger.warn(`Invalid price for token ${tokenId}`);
                    continue;
                }

                priceMap.set(tokenId, price);
                logger.debug("Batch price fetched", { token: tokenId, price });
            }
        }

        // Log summary of fetched prices
        logger.info(`Successfully fetched prices for ${priceMap.size} out of ${ids.length} tokens`);

        return priceMap;
    } catch (error) {
        logger.error("Error fetching batch prices:", error);
        throw error;
    }
}
