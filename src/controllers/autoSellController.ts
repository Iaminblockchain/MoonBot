import { botInstance, trade, removeTradeState } from "../bot";
import { SOLANA_CONNECTION } from "..";
import { TRADE } from "../types/trade";
import * as walletdb from "../models/walletModel";
import * as positiondb from "../models/positionModel";
import * as solana from "../solana/trade";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getTokenPriceBatch } from "../solana/getPrice";
import { logger } from "../logger";
import { getTokenMetaData } from "../solana/token";
import { getSPLBalance } from "./autoBuyController";
import { formatPrice } from "../solana/util";
import { parseTransaction } from "../solana/txhelpers";
import { PositionStatus } from "../models/positionModel";

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
                `❌ Auto-Sell Failed: ${tokenAddress}\n` +
                `Reason: Exceeded maximum retry attempts (${MAX_SELL_RETRIES})\n` +
                `Operation cancelled for safety`
            );
        }
        removeTradeState(chatId, tokenAddress);
        sellRetryCount.delete(ongoingSellKey);
        return;
    }

    logger.debug("Auto-sell check", { 
        chatId, 
        address: tokenAddress, 
        price,
        soldPercentage: info.soldTokenPercentage,
        remainingSteps: info.sellSteps.length
    });

    // Validate trade info
    if (!info.sellSteps || info.sellSteps.length === 0) {
        logger.error(`Invalid sell steps for token ${tokenAddress} and chat ${chatId}`);
        return;
    }

    // Sort sell steps by target price (ascending) and filter out completed steps
    const activeSteps = info.sellSteps
        .filter(step => step.sellPercentage > info.soldTokenPercentage)
        .sort((a, b) => a.targetPrice - b.targetPrice);

    if (activeSteps.length === 0) {
        logger.info(`No active sell steps remaining for ${tokenAddress}`);
        return;
    }

    // Get price thresholds
    const stopLossPrice = activeSteps[0].targetPrice;
    const highestTargetPrice = activeSteps[activeSteps.length - 1].targetPrice;
    
    // Determine sell action based on price conditions
    const sellDecision = determineSellAction(price, stopLossPrice, highestTargetPrice, activeSteps, info.soldTokenPercentage);

    if (!sellDecision.shouldSell) {
        logPriceStatus(tokenAddress, price, stopLossPrice, highestTargetPrice);
        return;
    }

    try {
        logSellTrigger(tokenAddress, price, sellDecision, info.soldTokenPercentage, chatId);
        ongoingSells.set(ongoingSellKey, true);
        await executeSell(tokenAddress, price, chatId, info, sellDecision.sellPercentage);
    } catch (error) {
        logger.error(`Error in processTrade for ${tokenAddress}:`, error);
        handleSellError(error, tokenAddress, chatId, currentRetries);
        throw error;
    } finally {
        ongoingSells.delete(ongoingSellKey);
    }
}

// Helper function to determine if and how much to sell
function determineSellAction(
    currentPrice: number,
    stopLossPrice: number,
    highestTargetPrice: number,
    activeSteps: Array<{ targetPrice: number; sellPercentage: number }>,
    soldPercentage: number
): { shouldSell: boolean; sellPercentage: number; reason: string } {
    // Check stop loss condition
    if (currentPrice < stopLossPrice) {
        return {
            shouldSell: true,
            sellPercentage: 100 - soldPercentage,
            reason: "Stop Loss Triggered"
        };
    }

    // Check highest target condition
    if (currentPrice > highestTargetPrice) {
        return {
            shouldSell: true,
            sellPercentage: 100 - soldPercentage,
            reason: "Highest Target Reached"
        };
    }

    // Find applicable step based on current price
    const applicableStep = activeSteps
        .filter(step => step.targetPrice <= currentPrice)
        .sort((a, b) => b.targetPrice - a.targetPrice)[0];

    if (applicableStep) {
        const remainingPercentage = applicableStep.sellPercentage - soldPercentage;
        if (remainingPercentage > 0) {
            return {
                shouldSell: true,
                sellPercentage: remainingPercentage,
                reason: `Target Price ${applicableStep.targetPrice} Reached`
            };
        }
    }

    return { shouldSell: false, sellPercentage: 0, reason: "" };
}

// Helper function to log price status
function logPriceStatus(tokenAddress: string, currentPrice: number, stopLossPrice: number, highestTargetPrice: number) {
    logger.info(
        `Price check for ${tokenAddress}:\n` +
        `Current: ${formatPrice(currentPrice)}\n` +
        `Stop Loss: ${formatPrice(stopLossPrice)}\n` +
        `Highest Target: ${formatPrice(highestTargetPrice)}\n` +
        `Status: Within range, no sell trigger`
    );
}

// Helper function to log sell trigger
function logSellTrigger(
    tokenAddress: string,
    price: number,
    sellDecision: { reason: string; sellPercentage: number },
    soldPercentage: number,
    chatId: string
) {
    logger.info(
        `Sell trigger for ${tokenAddress}:\n` +
        `Reason: ${sellDecision.reason}\n` +
        `Current Price: ${formatPrice(price)}\n` +
        `Sell Percentage: ${sellDecision.sellPercentage}%\n` +
        `Already Sold: ${soldPercentage}%\n` +
        `ChatId: ${chatId}`
    );
}

// Helper function to handle sell errors
function handleSellError(error: unknown, tokenAddress: string, chatId: string, currentRetries: number) {
    const ongoingSellKey = getOngoingSellKey(tokenAddress, chatId);
    const newRetryCount = currentRetries + 1;
    sellRetryCount.set(ongoingSellKey, newRetryCount);

    if (botInstance) {
        botInstance.sendMessage(
            chatId,
            `⚠️ Auto-Sell Warning: ${tokenAddress}\n` +
            `Attempt ${newRetryCount}/${MAX_SELL_RETRIES} failed\n` +
            `Will retry automatically`
        );
    }
}

// Execute the actual sell operation
async function executeSell(tokenAddress: string, price: number, chatId: string, info: TRADE, sellPercentage: number) {
    const wallet = await walletdb.getWalletByChatId(chatId);
    if (!wallet) {
        logger.error("Wallet not found", { chatId });
        return;
    }

    try {
        // Calculate amount to sell based on percentage
        const amountToSell = (info.amount * sellPercentage) / 100;
        
        const result = await solana.sell_swap(
            SOLANA_CONNECTION,
            wallet.privateKey,
            tokenAddress,
            amountToSell,
            500 // 5% slippage in basis points
        );

        if (result.success) {
            // Get transaction details
            const keypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
            const trxInfo = await parseTransaction(
                result.txSignature!,
                tokenAddress,
                keypair.publicKey.toString(),
                SOLANA_CONNECTION
            );

            // Update trade state
            const newSoldPercentage = info.soldTokenPercentage + sellPercentage;
            const newSoldAmount = info.soldTokenAmount + amountToSell;
            
            // Add to sold steps
            const soldStep = {
                soldPrice: trxInfo.tokenSolPrice || price,
                percentage: sellPercentage,
                solAmount: trxInfo.netBuySolAmount || 0
            };
            
            // Remove completed steps from sellSteps
            const remainingSteps = info.sellSteps.filter(step => 
                step.sellPercentage > newSoldPercentage
            );

            // Update trade state
            const updatedTrade: TRADE = {
                ...info,
                soldTokenPercentage: newSoldPercentage,
                soldTokenAmount: newSoldAmount,
                sellSteps: remainingSteps,
                soldSteps: [...info.soldSteps, soldStep]
            };

            // Get position from DB
            const position = await positiondb.getPositionByTokenAddress(chatId, tokenAddress);
            if (position) {
                // Update position with new sold steps
                const updatedPosition = {
                    ...position,
                    soldTokenAmount: newSoldAmount,
                    soldTokenPercentage: newSoldPercentage,
                    soldSteps: [...position.soldSteps, {
                        soldPrice: trxInfo.tokenSolPrice || price,
                        percentage: sellPercentage,
                        solAmount: trxInfo.netBuySolAmount || 0
                    }]
                };

                // If all tokens are sold, update position status and close price
                if (newSoldPercentage >= 100) {
                    updatedPosition.status = PositionStatus.CLOSED;
                    updatedPosition.closePriceUsd = trxInfo.tokenUsdPrice || 0;
                    updatedPosition.closePriceSol = trxInfo.tokenSolPrice || price;
                    updatedPosition.closeTime = new Date();
                    removeTradeState(chatId, tokenAddress);
                    
                    if (botInstance) {
                        await botInstance.sendMessage(
                            chatId,
                            `✅ Auto-Sell Complete!\n` +
                            `Token: ${tokenAddress}\n` +
                            `Total Sold: 100%\n` +
                            `Total Amount: ${newSoldAmount.toFixed(9)} SOL\n` +
                            `Final Price: ${(trxInfo.tokenSolPrice || price).toFixed(9)} SOL`
                        );
                    }
                } else {
                    // Update trade state with remaining steps
                    const prev = trade.get(chatId);
                    if (prev) {
                        const updatedTrades = prev.map(t => 
                            t.contractAddress === tokenAddress ? updatedTrade : t
                        );
                        trade.set(chatId, updatedTrades);
                    }
                }

                // Update position in DB
                await positiondb.updatePosition(chatId, tokenAddress, {
                    soldTokenAmount: newSoldAmount,
                    soldTokenPercentage: newSoldPercentage,
                    soldSteps: [...position.soldSteps, {
                        soldPrice: trxInfo.tokenSolPrice || price,
                        percentage: sellPercentage,
                        solAmount: trxInfo.netBuySolAmount || 0
                    }],
                    status: newSoldPercentage >= 100 ? PositionStatus.CLOSED : PositionStatus.OPEN,
                    ...(newSoldPercentage >= 100 ? {
                        closePriceUsd: trxInfo.tokenUsdPrice || 0,
                        closePriceSol: trxInfo.tokenSolPrice || price,
                        closeTime: new Date()
                    } : {})
                });

                // Send detailed sell step message
                if (botInstance) {
                    const tokenMetaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
                    await botInstance.sendMessage(
                        chatId,
                        `✅ Auto-Sell Step Executed!\n` +
                        `Token: ${tokenMetaData?.symbol || tokenAddress}\n` +
                        `Price: ${(trxInfo.tokenSolPrice || price).toFixed(9)} SOL\n` +
                        `Sold: ${sellPercentage}%\n` +
                        `Amount: ${amountToSell.toFixed(9)} SOL\n` +
                        `Total Sold: ${newSoldPercentage}%\n` +
                        `Total Amount Sold: ${newSoldAmount.toFixed(9)} SOL\n` +
                        `Transaction: https://solscan.io/tx/${result.txSignature}`
                    );
                }
            }
        } else {
            // Handle failed sell
            const retryCount = sellRetryCount.get(getOngoingSellKey(tokenAddress, chatId)) || 0;
            sellRetryCount.set(getOngoingSellKey(tokenAddress, chatId), retryCount + 1);
            
            if (botInstance) {
                await botInstance.sendMessage(
                    chatId,
                    `❌ Auto-Sell Failed!\n` +
                    `Token: ${tokenAddress}\n` +
                    `Reason: ${result.error || 'Unknown error'}\n` +
                    `Retry: ${retryCount + 1}/${MAX_SELL_RETRIES}`
                );
            }
        }
    } catch (error) {
        logger.error("Error in executeSell", { error, chatId, tokenAddress });
        throw error;
    }
}

// Handle the result of a sell operation
async function handleSellResult(
    result: { success: boolean; error?: string },
    tokenAddress: string,
    price: number,
    chatId: string,
    info: TRADE,
    retryCount: number
) {
    if (!botInstance) {
        logger.error("Bot instance not initialized in handleSellResult");
        return;
    }

    try {
        if (result.success) {
            const metadata = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
            const profitLoss = ((price / info.startPrice - 1) * 100).toFixed(1);
            const message =
                price > info.targetPrice
                    ? `Auto-Sell Token : You successfully sold ${metadata?.name}(${metadata?.symbol}) : ${tokenAddress} at Price: $${price} for a ${profitLoss}% gain`
                    : `Auto-Sell Token : You successfully sold ${metadata?.name}(${metadata?.symbol}) : ${tokenAddress} at Price: $${price} for a ${Math.abs(Number(profitLoss))}% loss`;

            await botInstance.sendMessage(chatId, message);
        } else {
            const errorMessage = result.error ? `\nReason: ${result.error}` : "\nReason: Transaction failed to confirm";
            const metadata = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
            const tokenInfo = metadata ? `${metadata.name}(${metadata.symbol})` : tokenAddress;
            await botInstance.sendMessage(
                chatId,
                `Auto-Sell Token : Failed to sell ${tokenInfo} after ${retryCount} attempts${errorMessage}`
            );
        }
    } catch (error) {
        logger.error(`Error sending message for ${tokenAddress}:`, error);
    } finally {
        removeTradeState(chatId, tokenAddress);
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

        // Combine all results into a single Map, handling failed batches
        const prices = new Map<string, number>();
        for (const result of batchResults) {
            if (result.status === "fulfilled") {
                for (const [token, price] of result.value) {
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
                    logger.error(`Error processing sell for ${tokenAddress}:`, error);
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