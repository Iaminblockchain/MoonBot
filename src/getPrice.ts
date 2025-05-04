const axios = require("axios");
import { logger } from "./logger";

export async function getTokenPrice(
    ids: string,
    vsToken: string | null = null,
    showExtraInfo: boolean = false
): Promise<number> {
    try {
        //vstoken is SOL by default
        const params: { ids: string; vsToken?: string; showExtraInfo?: boolean } = { ids };

        // Use showExtraInfo if true, otherwise use vsToken if provided
        if (showExtraInfo) {
            params.showExtraInfo = true;
        } else if (vsToken) {
            params.vsToken = vsToken;
        }

        const response = await axios.get("https://api.jup.ag/price/v2", { params });

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
