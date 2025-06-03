import { botInstance, trade, removeTradeState } from "../bot";
import { SOLANA_CONNECTION } from "..";
import { TRADE } from "../types/trade";
import * as walletdb from "../models/walletModel";
import * as solana from "../solana/trade";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getTokenPriceBatch } from "../solana/getPrice";
import { logger } from "../logger";
import { getTokenMetaData } from "../solana/token";
import { getSPLBalance } from "./autoBuyController";
import { formatPrice } from "../solana/util";
import * as positiondb from "../models/positionModel";

// Track ongoing sell operations to prevent race conditions
const ongoingSells = new Map<string, boolean>();
// Track retry attempts for each token
const sellRetryCount = new Map<string, number>();
const MAX_SELL_RETRIES = 5;

// Constants for configuration
const MIN_INTERVAL_MS = 1500;
// Minimum balance to attempt sell

// Get relevant token addresses to check for price changes
function getTokenAddresses(trade: Map<string, Array<TRADE>>, logger: typeof import("../logger").logger) {
    const tokenAddresses = new Set<string>();
    const tradeInfoMap = new Map<string, Array<{ chatId: string; info: TRADE }>>();

    logger.info(`trade size ${trade.size}`);
    logger.info(`tradeInfoMap size ${tradeInfoMap.size}`);

    trade.forEach((value, key) => {
        value.forEach((info: TRADE) => {
            if (!info.targetPrice || !info.stopPrice || !info.startPrice) {
                logger.warn(`Invalid trade info for chat ${key}, token ${info.contractAddress}`);
                return;
            }
            tokenAddresses.add(info.contractAddress);
            const existing = tradeInfoMap.get(info.contractAddress) || [];
            tradeInfoMap.set(info.contractAddress, [...existing, { chatId: key, info }]);
        });
    });

    logger.info(`tokenAddresses size ${tokenAddresses.size}`);

    const tokenArray = Array.from(tokenAddresses);
    return { tokenArray, tradeInfoMap };
}

// Helper function to generate unique key for ongoing sells
function getOngoingSellKey(tokenAddress: string, chatId: string): string {
    return `${tokenAddress}:${chatId}`;
}

// Process a single trade and execute sell if conditions are met
async function processTrade(tokenAddress: string, price: number, chatId: string, info: TRADE) {
    const ongoingSellKey = getOngoingSellKey(tokenAddress, chatId);

    // Skip if already processing a sell for this token and chatId combination
    if (ongoingSells.get(ongoingSellKey)) {
        logger.debug(`Sell operation already in progress for token ${tokenAddress} and chat ${chatId}`);
        return;
    }

    // Check if we've exceeded max retries
    const currentRetries = sellRetryCount.get(ongoingSellKey) || 0;
    if (currentRetries >= MAX_SELL_RETRIES) {
        logger.warn(`Max retries (${MAX_SELL_RETRIES}) exceeded for token ${tokenAddress} and chat ${chatId}`);
        if (botInstance) {
            await botInstance.sendMessage(
                chatId,
                `AutoSell Token : Failed to sell ${tokenAddress} after ${MAX_SELL_RETRIES} attempts - Operation cancelled`
            );
        }
        removeTradeState(chatId, tokenAddress);
        sellRetryCount.delete(ongoingSellKey);
        return;
    }

    logger.info(`AUTOSELL check ${tokenAddress}`, { chatId, address: tokenAddress, price });

    // Get the position to check sell steps
    const position = await positiondb.getPositionByTokenAddress(chatId, tokenAddress);
    if (!position) {
        logger.warn(`No position found for token ${tokenAddress} and chat ${chatId}`);
        return;
    }

    // Check each sell step
    let shouldSell = false;
    let sellReason = "";
    let sellPercentage = 0;

    for (const step of position.sellSteps) {
        const targetPrice = position.buyPriceSol * (1 + step.priceIncreasement / 100);
        const priceOffset = ((price - targetPrice) / targetPrice) * 100;

        // For positive price increases (take profit), sell when price is above target
        // For negative price increases (stop loss), sell when price is below target
        if ((step.priceIncreasement > 0 && price >= targetPrice) || 
            (step.priceIncreasement < 0 && price <= targetPrice)) {
            shouldSell = true;
            sellReason = step.priceIncreasement > 0 ? "Take Profit" : "Stop Loss";
            sellPercentage = step.sellPercentage;
            break;
        }

        logger.info(
            `AUTOSELL ${tokenAddress} Price ${formatPrice(price)} checking step\n` +
            `Current: ${formatPrice(price)}\n` +
            `Target: ${formatPrice(targetPrice)} (${priceOffset.toFixed(2)}% from target)\n` +
            `Step: ${step.sellPercentage}% at ${step.priceIncreasement > 0 ? '+' : ''}${step.priceIncreasement}%\n` +
            `No sell trigger`
        );
    }

    if (!shouldSell) {
        return;
    }

    try {
        logger.info(
            `AUTOSELL ${sellReason} triggers sell for ${tokenAddress}\t` +
            `Current: ${formatPrice(price)}\t` +
            `Buy Price: ${formatPrice(position.buyPriceSol)}\t` +
            `Sell Percentage: ${sellPercentage}%\t` +
            `ChatId: ${chatId}`
        );
        ongoingSells.set(ongoingSellKey, true);
        await executeSell(tokenAddress, price, chatId, info, sellPercentage);
    } catch (error) {
        logger.error(`Error in processTrade for ${tokenAddress}:`, error);
        throw error; // Re-throw to be handled by caller
    } finally {
        ongoingSells.delete(ongoingSellKey);
    }
}

// Execute the actual sell operation
async function executeSell(tokenAddress: string, price: number, chatId: string, info: TRADE, sellPercentage: number) {
    const wallet = await walletdb.getWalletByChatId(chatId);
    if (!wallet) {
        logger.warn(`No wallet found for chat ${chatId}`);
        return;
    }

    const walletData = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
    const splAmount = await getSPLBalance(tokenAddress, walletData.publicKey.toBase58());

    if (splAmount <= 0) {
        logger.warn(`No balance found for token ${tokenAddress} in wallet ${chatId}`);
        return;
    }

    // Calculate the amount to sell based on the percentage
    const amountToSell = Math.floor(splAmount * (sellPercentage / 100));

    const result = await solana.executeSwapWithRetry(
        SOLANA_CONNECTION,
        wallet.privateKey,
        tokenAddress,
        amountToSell,
        false // isBuy = false for sell operation
    );

    const ongoingSellKey = getOngoingSellKey(tokenAddress, chatId);
    if (!result.success) {
        // Increment retry counter on failure
        const currentRetries = sellRetryCount.get(ongoingSellKey) || 0;
        sellRetryCount.set(ongoingSellKey, currentRetries + 1);
    } else {
        // Reset retry counter on success
        sellRetryCount.delete(ongoingSellKey);
    }

    await handleSellResult(result, tokenAddress, price, chatId, info, sellRetryCount.get(ongoingSellKey) || 0, sellPercentage);
}

// Handle the result of a sell operation
async function handleSellResult(
    result: { success: boolean; error?: string },
    tokenAddress: string,
    price: number,
    chatId: string,
    info: TRADE,
    retryCount: number,
    sellPercentage: number
) {
    if (!botInstance) {
        logger.error("Bot instance not initialized in handleSellResult");
        return;
    }

    try {
        if (result.success) {
            const metadata = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
            const position = await positiondb.getPositionByTokenAddress(chatId, tokenAddress);
            if (!position) {
                throw new Error("Position not found");
            }

            // Calculate profit/loss
            const profitLoss = ((price / position.buyPriceSol - 1) * 100).toFixed(1);
            const isProfit = Number(profitLoss) >= 0;

            // Calculate SOL amount for this sell
            const soldSolAmount = price * (position.tokenAmount * (sellPercentage / 100));

            // Create detailed message
            const message = [
                `🔄 AutoSell Token Update:`,
                `Token: ${metadata?.name}(${metadata?.symbol})`,
                `Address: ${tokenAddress}`,
                `Sold: ${sellPercentage}% of position`,
                `Price: $${price.toFixed(6)}`,
                `Profit/Loss: ${profitLoss}% ${isProfit ? '📈' : '📉'}`,
                `SOL Amount: ${soldSolAmount.toFixed(4)} SOL`,
                `Remaining: ${100 - sellPercentage}% of position`
            ].join('\n');

            await botInstance.sendMessage(chatId, message);

            // Update position with sold step
            const soldStep = {
                soldPrice: price,
                sellPercentage: sellPercentage,
                solAmount: soldSolAmount,
                timestamp: new Date()
            };

            // Update position with new sold step
            await positiondb.updatePosition(chatId, tokenAddress, {
                soldSteps: [...position.soldSteps, soldStep]
            });

            // If this was a 100% sell, close the position and send final message
            if (sellPercentage === 100) {
                await positiondb.closePosition(chatId, tokenAddress, price, price);
                removeTradeState(chatId, tokenAddress);

                const finalMessage = [
                    `✅ Position Closed:`,
                    `Token: ${metadata?.name}(${metadata?.symbol})`,
                    `Final Price: $${price.toFixed(6)}`,
                    `Total Profit/Loss: ${profitLoss}% ${isProfit ? '📈' : '📉'}`,
                    `Total SOL Amount: ${soldSolAmount.toFixed(4)} SOL`
                ].join('\n');

                await botInstance.sendMessage(chatId, finalMessage);
            }
        } else {
            const errorMessage = result.error ? `\nReason: ${result.error}` : "\nReason: Transaction failed to confirm";
            const metadata = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
            const tokenInfo = metadata ? `${metadata.name}(${metadata.symbol})` : tokenAddress;
            
            const errorMsg = [
                `❌ AutoSell Failed:`,
                `Token: ${tokenInfo}`,
                `Attempt: ${retryCount}/${MAX_SELL_RETRIES}`,
                `Percentage: ${sellPercentage}%`,
                errorMessage
            ].join('\n');

            await botInstance.sendMessage(chatId, errorMsg);
        }
    } catch (error) {
        logger.error(`Error sending message for ${tokenAddress}:`, error);
        // Send error message to user
        if (botInstance) {
            await botInstance.sendMessage(
                chatId,
                `❌ Error processing sell for ${tokenAddress}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }
}

export const autoSellHandler = async () => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in autoSellHandler");
        return;
    }

    try {
        const { tokenArray, tradeInfoMap } = getTokenAddresses(trade, logger);
        logger.info(`auto check Processing ${tokenArray.length} tokens`);

        const batchLength = 100;
        const batches = [];

        // Split tokens into batches
        for (let i = 0; i < tokenArray.length; i += batchLength) {
            batches.push(tokenArray.slice(i, i + batchLength));
        }

        // Execute all batch requests in parallel with error handling
        const batchResults = await Promise.allSettled(batches.map((batch) => getTokenPriceBatch(batch)));

        // Add debug logging for price data
        logger.info("Raw price data from batches:", JSON.stringify(batchResults, null, 2));

        // Combine all results into a single Map, handling failed batches
        const prices = new Map<string, number>();
        for (const result of batchResults) {
            if (result.status === "fulfilled") {
                for (const [token, price] of result.value) {
                    // Add debug logging for each price
                    logger.info(`AUTOSELL Token ${token} raw price: ${price}`);
                    prices.set(token, price);
                }
            } else {
                logger.error("Batch price fetch failed:", result.reason);
            }
        }

        logger.info(`auto check prices ${prices.size} prices`);

        // Process each price in the combined results
        for (const [tokenAddress, price] of prices) {
            const tradeInfos = tradeInfoMap.get(tokenAddress);
            if (!tradeInfos) continue;

            // Process each trade for this token
            for (const { chatId, info } of tradeInfos) {
                try {
                    await processTrade(tokenAddress, price, chatId, info);
                } catch (error: unknown) {
                    logger.error(`AUTOSELL Error processing sell for ${tokenAddress}:`, error);
                    if (botInstance) {
                        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
                        await botInstance.sendMessage(chatId, `Error processing auto-sell for ${tokenAddress}: ${errorMessage}`);
                    }
                }
            }
        }
    } catch (e) {
        logger.error(`Auto-Sell Error:`, e);
    }
};

export const runAutoSellSchedule = async () => {
    logger.info("start runAutoSellSchedule");
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;
    const BASE_BACKOFF_MS = 5000; // Base delay of 5 seconds
    const MAX_BACKOFF_MS = 60000; // Maximum delay of 1 minute
    let running = true;

    while (running) {
        try {
            logger.info("check auto sell conditions");
            const startTime = Date.now();

            await autoSellHandler();
            consecutiveErrors = 0; // Reset error count on success

            // Calculate how long to wait to maintain minimum interval
            const elapsed = Date.now() - startTime;
            const waitTime = Math.max(0, MIN_INTERVAL_MS - elapsed);

            if (waitTime > 0) {
                await new Promise((resolve) => setTimeout(resolve, waitTime));
            }
        } catch (error) {
            consecutiveErrors++;
            logger.error(`Error in auto sell loop: ${error}`);

            // Linear backoff: increase by BASE_BACKOFF_MS for each consecutive error
            const backoffTime = Math.min(BASE_BACKOFF_MS * consecutiveErrors, MAX_BACKOFF_MS);
            await new Promise((resolve) => setTimeout(resolve, backoffTime));

            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                logger.error("Too many consecutive errors, pausing auto-sell for 5 minutes");
                await new Promise((resolve) => setTimeout(resolve, 300000));
                consecutiveErrors = 0;
                running = false; // Stop the loop if too many errors
            }
        }
    }
};
