import axios from "axios";
import { logger } from "../logger";
import { JUPYTER_BASE_URL } from "../util/constants";

const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";

//By default, prices are denominated by USD
export async function getSOLpriceUSD(): Promise<number> {
    try {
        // Use the existing getTokenPriceUSD function with WSOL_ADDRESS
        const price = await getTokenPriceUSD(WSOL_ADDRESS);
        return price;
    } catch (error) {
        logger.error("Error fetching SOL price:", error);
        throw error;
    }
}

export async function getTokenPriceUSD(ids: string, vsToken: string | null = null, showExtraInfo: boolean = false): Promise<number> {
    try {
        // Construct URL with ids as a query parameter
        let url = `${JUPYTER_BASE_URL}/price/v2?ids=${encodeURIComponent(ids)}`;

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

export async function getTokenPriceSOL(ids: string): Promise<number> {
    try {
        // For WSOL, return 1 as it's the base token
        if (ids === WSOL_ADDRESS) {
            return 1;
        }

        // Construct URL with ids as a query parameter
        let url = `${JUPYTER_BASE_URL}/price/v2?ids=${encodeURIComponent(ids)}`;
        url += `&vsToken=${encodeURIComponent(WSOL_ADDRESS)}`;

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

                // Add debug logging to help diagnose issues
                logger.debug("Price in SOL", {
                    token: tokenInfo.id,
                    price,
                    rawData: tokenInfo,
                });
                return price;
            }
        }

        // If no price is found, throw an error
        throw new Error(`No price found for token(s): ${ids}`);
    } catch (error) {
        logger.error(`Error fetching SOL price for ${ids}:`, error);
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

        const priceMap = new Map<string, number>();

        // Filter out WSOL from the tokens to fetch
        const tokensToFetch = ids.filter((id) => id !== WSOL_ADDRESS);

        // Add WSOL to the result map with price 1
        if (ids.includes(WSOL_ADDRESS)) {
            priceMap.set(WSOL_ADDRESS, 1);
            logger.debug("Added WSOL to batch results with price 1");
        }

        // If no other tokens to fetch, return early
        if (tokensToFetch.length === 0) {
            return priceMap;
        }

        // Join all token IDs with commas
        const idsString = tokensToFetch.join(",");
        const url = `${JUPYTER_BASE_URL}/price/v2?ids=${encodeURIComponent(idsString)}&vsToken=${WSOL_ADDRESS}`;

        const response = await axios.get(url);
        const priceData = response.data.data;

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
