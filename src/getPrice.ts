const axios = require("axios");
import { logger } from "./logger";

export async function getTokenPrice(ids: string, vsToken: string | null = null, showExtraInfo: boolean = false): Promise<any> {
    try {
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
                logger.debug("Price ", { token: tokenInfo.id, price: tokenInfo.price });
                return tokenInfo.price;
            }
        }

        logger.error("price not found");
    } catch (error) {
        logger.error("Error fetching price:", error);
        throw error;
    }
}
