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
 * Fetches prices for multiple tokens in a single API call (generic version)
 * @param ids Array of token addresses to fetch prices for
 * @param vsToken The quote token address (e.g., WSOL for SOL, or 'usd' for USD)
 * @returns Map of token addresses to their prices in the specified quote token
 */
async function getTokenPriceBatchGeneric(ids: string[], vsToken: string): Promise<Map<string, number>> {
    try {
        if (ids.length === 0) {
            return new Map();
        }

        const priceMap = new Map<string, number>();

        // Join all token IDs with commas
        const idsString = ids.join(",");
        let url = `${JUPYTER_BASE_URL}/price/v2?ids=${encodeURIComponent(idsString)}`;
        if (vsToken && vsToken.toLowerCase() !== "usd") {
            url += `&vsToken=${encodeURIComponent(vsToken)}`;
        }

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
                logger.debug(`Batch price fetched (${vsToken})`, { token: tokenId, price });
            }
        }

        // Log summary of fetched prices
        logger.info(`Successfully fetched ${vsToken} prices for ${priceMap.size} out of ${ids.length} tokens`);

        return priceMap;
    } catch (error) {
        logger.error(`Error fetching batch ${vsToken} prices:`, error);
        throw error;
    }
}

/**
 * Fetches prices for multiple tokens in batches with parallel processing (generic version)
 * @param ids Array of token addresses to fetch prices for
 * @param vsToken The quote token address (e.g., WSOL for SOL, or 'usd' for USD)
 * @param batchSize Optional batch size for processing (default: 100)
 * @returns Map of token addresses to their prices in the specified quote token
 */
async function getTokenPriceBatchAllGeneric(ids: string[], vsToken: string): Promise<Map<string, number>> {
    const batchSize = 100;
    try {
        if (ids.length === 0) {
            return new Map();
        }

        // Split tokens into batches
        const batches: string[][] = [];
        for (let i = 0; i < ids.length; i += batchSize) {
            batches.push(ids.slice(i, i + batchSize));
        }

        logger.info(`Split tokens into ${batches.length} batches for ${vsToken} price checking`);

        // Execute all batch requests in parallel with error handling
        const batchResults = await Promise.allSettled(batches.map((batch) => getTokenPriceBatchGeneric(batch, vsToken)));

        // Combine all results into a single Map, handling failed batches
        const prices = new Map<string, number>();
        let successfulBatches = 0;
        let failedBatches = 0;
        let totalPricesFetched = 0;

        for (const result of batchResults) {
            if (result.status === "fulfilled") {
                successfulBatches++;
                for (const [token, price] of result.value) {
                    totalPricesFetched++;
                    prices.set(token, price);
                }
            } else {
                failedBatches++;
                logger.error(`Batch ${vsToken} price fetch failed:`, result.reason);
            }
        }

        // Log summary of fetched prices
        logger.info(`${vsToken.toUpperCase()} Price Check Summary:`, {
            totalTokens: ids.length,
            successfulBatches,
            failedBatches,
            totalPricesFetched,
            successRate: `${((successfulBatches / batches.length) * 100).toFixed(2)}%`,
        });

        return prices;
    } catch (error) {
        logger.error(`Error in getTokenPriceBatchAllGeneric (${vsToken}):`, error);
        throw error;
    }
}

export async function getTokenPriceBatchSOL(ids: string[]): Promise<Map<string, number>> {
    return getTokenPriceBatchAllGeneric(ids, WSOL_ADDRESS);
}

export async function getTokenPriceBatchUSD(ids: string[]): Promise<Map<string, number>> {
    return getTokenPriceBatchAllGeneric(ids, "usd");
}
