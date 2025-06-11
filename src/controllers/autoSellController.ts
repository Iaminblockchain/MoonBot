import { botInstance, trade, removeTradeState, setTradeState } from "../bot";
import { TRADE, SellStep, SoldStep } from "../solana/types";
import { SOLANA_CONNECTION } from "..";
import * as walletdb from "../models/walletModel";
import * as solana from "../solana/trade";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getSPLBalance } from "./autoBuyController";
import { getTokenPriceBatchSOL, getTokenPriceInSOL } from "../solana/getPrice";
import { logger } from "../logger";
import { getTokenMetaData } from "../solana/token";
import { formatPrice } from "../solana/util";
import { sendMessageToUser } from "../bot";

const ongoingSells = new Map<string, boolean>();

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

    // Add detailed price logging at the start
    logger.info(`AUTOSELL Price Check for ${tokenAddress}`, {
        chatId,
        currentPrice: formatPrice(price),
        startPrice: formatPrice(info.startPrice),
        priceChange: `${((price / info.startPrice - 1) * 100).toFixed(2)}%`,
    });

    // Skip if already processing a sell for this token and chatId combination
    if (ongoingSells.get(ongoingSellKey)) {
        logger.info(`Sell operation already in progress for token ${tokenAddress} and chat ${chatId}`);
        return;
    }

    // Check if any sell step conditions are met
    let shouldSell = false;
    let sellReason = "";
    let sellPercentage = 0;
    let targetStep: SellStep | null = null;
    let startPrice = info.startPrice;

    // First check stop loss (first step)
    if (info.sellSteps.length > 0) {
        const stopLossStep = info.sellSteps[0];
        if (price <= stopLossStep.targetPrice && stopLossStep.targetPrice <= startPrice) {
            shouldSell = true;
            sellReason = `Stop Loss triggered at ${((stopLossStep.targetPrice / info.startPrice - 1) * 100).toFixed(2)}%`;
            sellPercentage = stopLossStep.sellPercentage - info.soldTokenPercentage;
            targetStep = stopLossStep;

            // Remove stop loss step and update trade state
            const updatedSellSteps = info.sellSteps.filter((step) => step !== stopLossStep);
            const updatedTrade: TRADE = {
                ...info,
                sellSteps: updatedSellSteps,
            };
            // Update the existing trade instead of appending
            const existingTrades = trade.get(chatId) || [];
            const updatedTrades = existingTrades.map((t) => (t.contractAddress === tokenAddress ? updatedTrade : t));
            trade.set(chatId, updatedTrades);
        }
    }

    // If stop loss not triggered, check limit orders
    if (!shouldSell && info.sellSteps.length > 0) {
        // Find the highest target price that's above current price
        let highestTargetStep: SellStep | null = null;
        for (let i = 0; i < info.sellSteps.length; i++) {
            const step = info.sellSteps[i];
            if (price >= step.targetPrice && step.targetPrice >= startPrice) {
                if (!highestTargetStep || step.targetPrice > highestTargetStep.targetPrice) {
                    highestTargetStep = step;
                }
            }
        }

        if (highestTargetStep) {
            shouldSell = true;
            sellReason = `Hit Limit Order at ${((highestTargetStep.targetPrice / info.startPrice - 1) * 100).toFixed(2)}%`;
            sellPercentage = highestTargetStep.sellPercentage - info.soldTokenPercentage;
            targetStep = highestTargetStep;

            // Remove the executed step and any steps with lower price targets
            const updatedSellSteps = info.sellSteps.filter(
                (step) => step.targetPrice > targetStep!.targetPrice // Keep steps with higher price targets
            );

            // Update trade state immediately
            const updatedTrade: TRADE = {
                ...info,
                sellSteps: updatedSellSteps,
            };
            // Update the existing trade instead of appending
            const existingTrades = trade.get(chatId) || [];
            const updatedTrades = existingTrades.map((t) => (t.contractAddress === tokenAddress ? updatedTrade : t));
            trade.set(chatId, updatedTrades);
        }
    }

    if (!shouldSell) {
        logger.info(
            `AUTOSELL ${tokenAddress} Price Check Summary:\n` +
                `Current Price: ${formatPrice(price)} (${((price / info.startPrice - 1) * 100).toFixed(2)}% from start)\n` +
                `Status: No sell trigger - Price within range`
        );
        return;
    }

    try {
        logger.info(
            `AUTOSELL ${sellReason} Triggered for ${tokenAddress}\n` +
                `Current Price: ${formatPrice(price)} (${((price / info.startPrice - 1) * 100).toFixed(2)}% from start)\n` +
                `Start Price: ${formatPrice(info.startPrice)}\n` +
                `Sell Percentage: ${sellPercentage}%\n` +
                `ChatId: ${chatId}`
        );
        ongoingSells.set(ongoingSellKey, true);
        await executeSell(tokenAddress, price, chatId, info, sellPercentage, targetStep!);
    } catch (error) {
        logger.error(`Error in processTrade for ${tokenAddress}:`, error);
        throw error;
    } finally {
        ongoingSells.delete(ongoingSellKey);
    }
}

async function executeSell(tokenAddress: string, price: number, chatId: string, info: TRADE, sellPercentage: number, targetStep: SellStep) {
    const wallet = await walletdb.getWalletByChatId(chatId);
    if (!wallet) {
        logger.warn(`No wallet found for chat ${chatId}`);
        return;
    }

    const walletData = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
    const tokenInfo = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
    const decimal = tokenInfo?.decimals || 6;
    const splAmount = info.totalTokenAmount * Math.pow(10, decimal);

    if (splAmount <= 0) {
        logger.warn(`No balance found for token ${tokenAddress} in wallet ${chatId}`);
        return;
    }

    const sp = targetStep.sellPercentage - info.soldTokenPercentage;
    if (sp <= 0) {
        logger.warn(`No balance found for token ${tokenAddress} in wallet ${chatId}`);
        return;
    }

    // Calculate amount to sell based on percentage
    const amountToSell = Math.floor(splAmount * (sp / 100));

    //tried once only, on retry policy
    let result = await solana.sell_swap(SOLANA_CONNECTION, wallet.privateKey, info.contractAddress, amountToSell);

    await handleSellResult(result, tokenAddress, price, chatId, info, sellPercentage, targetStep);
}

async function handleSellResult(
    result: {
        success: boolean;
        error?: string;
        txSignature?: string | null;
        sol_balance_change?: number;
        token_balance_change?: number;
        fees?: number;
        timingMetrics?: TimingMetrics;
    },
    tokenAddress: string,
    price: number,
    chatId: string,
    info: TRADE,
    sellPercentage: number,
    targetStep: SellStep
) {
    if (!botInstance) {
        logger.error("Bot instance not initialized in handleSellResult");
        return;
    }

    try {
        if (result.success) {
            const metadata = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
            const profitLoss = ((price / info.startPrice - 1) * 100).toFixed(1);
            const priceIncrement = (price / info.startPrice - 1) * 100;
            const remainingPercentage = 100 - (info.soldTokenPercentage + sellPercentage);

            const msg = await getSellSuccessMessage(
                `http://solscan.io/tx/${result.txSignature}`,
                tokenAddress,
                `${profitLoss}%`,
                price,
                result.sol_balance_change ?? 0,
                result.token_balance_change ?? 0,
                result.fees ?? 0,
                result.timingMetrics,
                metadata,
                {
                    priceIncrement,
                    soldPercentage: sellPercentage,
                    remainingPercentage,
                }
            );
            await sendMessageToUser(chatId, msg);

            // Update trade with sold step
            const soldStep: SoldStep = {
                soldPrice: price,
                soldPercentage: sellPercentage,
                soldTokenAmount: result.token_balance_change ?? 0,
                soldTime: new Date(),
            };

            const updatedSoldSteps = [...info.soldSteps, soldStep];

            // Get the current trade state to preserve the updated sell steps
            const existingTrades = trade.get(chatId) || [];
            const currentTrade = existingTrades.find((t) => t.contractAddress === tokenAddress);

            if (!currentTrade) {
                logger.error(`Trade not found for ${tokenAddress} in chat ${chatId}`);
                return;
            }

            // Update trade state while preserving the current sell steps
            const updatedTrade: TRADE = {
                ...currentTrade, // Use currentTrade instead of info to preserve updated sell steps
                soldTokenAmount: currentTrade.soldTokenAmount + (result.token_balance_change ?? 0),
                soldTokenPercentage: currentTrade.soldTokenPercentage + sellPercentage,
                soldSteps: updatedSoldSteps,
            };

            // If all tokens are sold, remove the trade
            if (targetStep.sellPercentage == 100) {
                removeTradeState(chatId, tokenAddress);
            } else {
                // Update trade state with new values
                const updatedTrades = existingTrades.map((t) => (t.contractAddress === tokenAddress ? updatedTrade : t));
                trade.set(chatId, updatedTrades);
            }
        } else {
            const errorMessage = result.error ? `\nReason: ${result.error}` : "\nReason: Transaction failed to confirm";
            const metadata = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
            const tokenInfo = metadata ? `${metadata.name}(${metadata.symbol})` : tokenAddress;
            await sendMessageToUser(chatId, `AutoSell Token : Failed to sell ${tokenInfo}`);
        }
    } catch (error) {
        logger.error(`Error sending message for ${tokenAddress}:`, error);
    }
}

//run through each signal and check if sell is triggered
export const autoSellHandler = async () => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in autoSellHandler");
        return;
    }

    const { tokenArray, tradeInfoMap } = getTokenAddresses(trade, logger);
    logger.info(`Starting autosell price check for ${tokenArray.length} tokens`);

    // Get prices for all tokens in batches
    const prices = await getTokenPriceBatchSOL(tokenArray);

    // Process each price in the results
    for (const [tokenAddress, price] of prices) {
        const tradeInfos = tradeInfoMap.get(tokenAddress);
        if (!tradeInfos) continue;

        // let p = (await getTokenPriceInSOL(tokenAddress)) || 0;
        // if (p == 0) continue;

        // Process each trade for this token
        for (const { chatId, info } of tradeInfos) {
            try {
                await processTrade(tokenAddress, price, chatId, info);
            } catch (error: unknown) {
                logger.error(`AUTOSELL Error processing sell for ${tokenAddress}:`, error);
                if (botInstance) {
                    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
                    await sendMessageToUser(chatId, `Error processing auto-sell for ${tokenAddress}: ${errorMessage}`);
                }
            }
        }
    }
};

// Add this interface near the top of the file with other interfaces
interface TimingMetrics {
    intervals: {
        priceCheckDuration: number;
        walletFetchDuration: number;
        balanceCheckDuration: number;
        swapDuration: number;
        metadataFetchDuration: number;
        messageSendDuration: number;
        totalDuration: number;
    };
}

const getSellSuccessMessage = async (
    trx: string,
    tokenAddress: string,
    trade_type: string,
    price: number,
    solAmount: number,
    tokenBalanceChange: number,
    fees: number,
    timingMetrics?: TimingMetrics,
    metadata?: { name: string; symbol: string } | null,
    sellInfo?: {
        priceIncrement: number;
        soldPercentage: number;
        remainingPercentage: number;
    }
) => {
    const tokenInfo = tokenBalanceChange ? `\nTokens sold: ${Math.abs(tokenBalanceChange).toLocaleString()}` : "";
    const solInfo = solAmount ? `\nSOL Amount: ${Math.abs(solAmount).toFixed(6)}` : "";
    const tokenName = metadata ? `${metadata.name}(${metadata.symbol})` : tokenAddress;

    let message = `${trade_type} successful\nToken: ${tokenName}\n${solInfo}\n${tokenInfo}\n${trx}`;

    if (sellInfo) {
        message += `\n\nSell Details:`;
        message += `\nPrice Increase: ${sellInfo.priceIncrement.toFixed(2)}%`;
        message += `\nSold Percentage: ${sellInfo.soldPercentage.toFixed(2)}%`;
        message += `\nRemaining Percentage: ${sellInfo.remainingPercentage.toFixed(2)}%`;
    }

    if (timingMetrics) {
        message += `\n\nTiming Information:`;
        message += `\nTotal Duration: ${(timingMetrics.intervals.totalDuration / 1000).toFixed(2)}s`;
        message += `\nSwap Duration: ${(timingMetrics.intervals.swapDuration / 1000).toFixed(2)}s`;
        message += `\nPrice Check: ${(timingMetrics.intervals.priceCheckDuration / 1000).toFixed(2)}s`;
        message += `\nWallet Fetch: ${(timingMetrics.intervals.walletFetchDuration / 1000).toFixed(2)}s`;
        message += `\nBalance Check: ${(timingMetrics.intervals.balanceCheckDuration / 1000).toFixed(2)}s`;
    }

    return message;
};

export const runAutoSellSchedule = () => {
    logger.info("start runAutoSellSchedule");
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;
    const BASE_BACKOFF_MS = 5000; // Base delay of 5 seconds
    const MAX_BACKOFF_MS = 60000; // Maximum delay of 1 minute
    const MIN_INTERVAL_MS = 1500;
    let running = true;

    const runLoop = async () => {
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
                logger.error(`Error in auto sell loop (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error}`);

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    logger.error("Too many consecutive errors, pausing auto-sell for 5 minutes");
                    await new Promise((resolve) => setTimeout(resolve, 300000));
                    consecutiveErrors = 0;
                    continue;
                }

                // Linear backoff
                const backoffTime = Math.min(BASE_BACKOFF_MS * consecutiveErrors, MAX_BACKOFF_MS);
                logger.info(`Backing off for ${backoffTime / 1000} seconds before next attempt`);
                await new Promise((resolve) => setTimeout(resolve, backoffTime));
            }
        }
    };

    // Start the loop in the background
    runLoop().catch((error) => {
        logger.error("Fatal error in auto sell loop:", error);
        running = false;
    });

    // Return a function to stop the loop if needed
    return () => {
        running = false;
    };
};
