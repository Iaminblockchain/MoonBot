import axios from 'axios';
import { logger } from "./logger";

const BASE_URL = "https://lite-api.jup.ag/price/v2";

export async function getTokenPrice(
    ids: string,
    vsToken: string | null = null,
    showExtraInfo: boolean = false
): Promise<number> {
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