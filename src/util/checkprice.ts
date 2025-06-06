import { getTokenPriceBatchSOL, getTokenPriceSOL } from "../solana/getPrice";
import * as dotenv from "dotenv";
import { logger } from "../logger";

// Load environment variables
dotenv.config();

async function checkPrice() {
    try {
        const tokenMints = [
            "6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump",
            // "So11111111111111111111111111111111111111112", // WSOL
            // "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
        ];

        logger.info("\nGetting prices individually:");
        for (const mint of tokenMints) {
            try {
                const price = await getTokenPriceSOL(mint);
                logger.info(`${mint}: ${price} SOL`);
            } catch (error) {
                logger.error(`Failed to get price for ${mint}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        logger.info("\nGetting prices in batch:");
        try {
            const batchPrices = await getTokenPriceBatchSOL(tokenMints);
            for (const [mint, price] of batchPrices.entries()) {
                logger.info(`${mint}: ${price} SOL`);
            }

            logger.info("\nComparing results:");
            for (const mint of tokenMints) {
                try {
                    const individualPrice = await getTokenPriceSOL(mint);
                    const batchPrice = batchPrices.get(mint);

                    if (batchPrice !== undefined) {
                        const difference = Math.abs(individualPrice - batchPrice);
                        const percentDiff = (difference / individualPrice) * 100;
                        logger.info(`${mint}:`);
                        logger.info(`  Individual: ${individualPrice} SOL`);
                        logger.info(`  Batch: ${batchPrice} SOL`);
                        logger.info(`  Difference: ${difference.toFixed(6)} SOL (${percentDiff.toFixed(2)}%)`);

                        // Add warning if difference is significant
                        if (percentDiff > 1) {
                            logger.warn(`  WARNING: Large price difference detected!`);
                        }
                    } else {
                        logger.error(`No batch price found for ${mint}`);
                    }
                } catch (error) {
                    logger.error(`Failed to compare prices for ${mint}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        } catch (error) {
            logger.error(`Failed to get batch prices: ${error instanceof Error ? error.message : String(error)}`);
        }
    } catch (error) {
        logger.error(`Error in checkPrice: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Run the check
checkPrice().catch((error) => {
    logger.error("Unhandled error in main:", error);
    process.exit(1);
});
