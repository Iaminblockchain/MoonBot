import { botInstance, trade, removeTradeState } from "../bot";
import { TRADE } from "../solana/types";
import { SOLANA_CONNECTION } from "..";
import * as walletdb from "../models/walletModel";
import * as solana from "../solana/trade";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getSPLBalance } from "./autoBuyController";
import { getTokenPriceBatchSOL } from "../solana/getPrice";
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
        targetPrice: formatPrice(info.targetPrice),
        stopPrice: formatPrice(info.stopPrice),
        priceChange: `${((price / info.startPrice - 1) * 100).toFixed(2)}%`,
    });

    // Skip if already processing a sell for this token and chatId combination
    if (ongoingSells.get(ongoingSellKey)) {
        logger.info(`Sell operation already in progress for token ${tokenAddress} and chat ${chatId}`);
        return;
    }

    // Calculate price change percentage
    const priceChangePercent = (price / info.startPrice - 1) * 100;

    // Skip if price change is too extreme (more than 80% drop)
    if (priceChangePercent < -80) {
        logger.error(
            `AUTOSELL extreme price movement for ${tokenAddress}\n` +
                `Current Price: ${formatPrice(price)} (${priceChangePercent.toFixed(2)}% from start)\n` +
                `Start Price: ${formatPrice(info.startPrice)}\n` +
                `Target Price: ${formatPrice(info.targetPrice)}\n` +
                `Stop Price: ${formatPrice(info.stopPrice)}\n` +
                `ChatId: ${chatId}`
        );
    }

    // Check if price is outside the target range (either above target or below low)
    let hitTP = price > info.targetPrice;
    let hitSL = price < info.stopPrice;
    const shouldSell = hitTP || hitSL;

    // Calculate price offsets
    const tpOffset = (((price - info.targetPrice) / info.targetPrice) * 100).toFixed(2);
    const slOffset = (((price - info.stopPrice) / info.stopPrice) * 100).toFixed(2);

    if (!shouldSell) {
        logger.info(
            `AUTOSELL ${tokenAddress} Price Check Summary:\n` +
                `Current Price: ${formatPrice(price)} (${((price / info.startPrice - 1) * 100).toFixed(2)}% from start)\n` +
                `Target Price: ${formatPrice(info.targetPrice)} (${tpOffset}% from target)\n` +
                `Stop Price: ${formatPrice(info.stopPrice)} (${slOffset}% from stop)\n` +
                `Status: No sell trigger - Price within range`
        );
        return;
    } else {
        try {
            let reason = "";
            if (hitTP) {
                reason = "Hit Take Profit";
            } else if (hitSL) {
                reason = "Hit Stop Loss";
            } else {
                reason = "Unknown reason";
            }
            logger.info(
                `AUTOSELL ${reason} Triggered for ${tokenAddress}\n` +
                    `Current Price: ${formatPrice(price)} (${((price / info.startPrice - 1) * 100).toFixed(2)}% from start)\n` +
                    `Start Price: ${formatPrice(info.startPrice)}\n` +
                    `Target Price: ${formatPrice(info.targetPrice)} (${tpOffset}% from target)\n` +
                    `Stop Price: ${formatPrice(info.stopPrice)} (${slOffset}% from stop)\n` +
                    `ChatId: ${chatId}`
            );
            ongoingSells.set(ongoingSellKey, true);
            await executeSell(tokenAddress, price, chatId, info);
        } catch (error) {
            logger.error(`Error in processTrade for ${tokenAddress}:`, error);
            throw error; // Re-throw to be handled by caller
        } finally {
            ongoingSells.delete(ongoingSellKey);
        }
    }
}

async function executeSell(tokenAddress: string, price: number, chatId: string, info: TRADE) {
    const wallet = await walletdb.getWalletByChatId(chatId);
    if (!wallet) {
        logger.warn(`No wallet found for chat ${chatId}`);
        return;
    }

    const walletData = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
    const splAmount = await getSPLBalance(tokenAddress, walletData.publicKey.toBase58());

    if (splAmount <= 0) {
        logger.error(`No balance found for token ${tokenAddress} in wallet ${chatId}`);
        // Remove trade state to prevent repeated attempts
        removeTradeState(chatId, tokenAddress);
        return;
    }

    //tried once only, on retry policy
    logger.info(`execute autosell: splAmount ${splAmount} chatId ${chatId} tokenAddress ${tokenAddress}`);
    let result = await solana.sell_swap(SOLANA_CONNECTION, wallet.privateKey, info.contractAddress, splAmount);
    logger.info(`autosell sell_swap result chatId ${chatId} result ${result}`);

    await handleSellResult(result, tokenAddress, price, chatId, info);
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
    info: TRADE
) {
    if (!botInstance) {
        logger.error("Bot instance not initialized in handleSellResult");
        return;
    }

    try {
        if (result.success) {
            //TODO! can get this info earlier
            const metadata = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);

            //TODO! review calculate PnL
            const profitLoss = ((price / info.startPrice - 1) * 100).toFixed(1);
            const msg = await getSellSuccessMessage(
                `http://solscan.io/tx/${result.txSignature}`,
                tokenAddress,
                `${profitLoss}%`,
                price,
                result.sol_balance_change ?? 0,
                result.token_balance_change ?? 0,
                result.fees ?? 0,
                result.timingMetrics,
                metadata
            );
            await sendMessageToUser(chatId, msg);
        } else {
            const errorMessage = result.error ? `\nReason: ${result.error}` : "\nReason: Transaction failed to confirm";
            const metadata = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
            const tokenInfo = metadata ? `${metadata.name}(${metadata.symbol})` : tokenAddress;
            await sendMessageToUser(chatId, `AutoSell Token : Failed to sell ${tokenInfo}`);
        }
    } catch (error) {
        logger.error(`Error sending message for ${tokenAddress}:`, error);
    } finally {
        removeTradeState(chatId, tokenAddress);
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
    metadata?: { name: string; symbol: string } | null
) => {
    const tokenInfo = tokenBalanceChange ? `\nTokens sold: ${Math.abs(tokenBalanceChange).toLocaleString()}` : "";
    const solInfo = solAmount ? `\nSOL Amount: ${Math.abs(solAmount).toFixed(6)}` : "";
    const tokenName = metadata ? `${metadata.name}(${metadata.symbol})` : tokenAddress;

    let message = `${trade_type} successful\nToken: ${tokenName}\n${solInfo}\n${tokenInfo}\n${trx}`;

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

    // Start the loop in the background without waiting for it
    setImmediate(() => {
        runLoop().catch((error) => {
            logger.error("Fatal error in auto sell loop:", error);
            running = false;
        });
    });

    // Return a function to stop the loop if needed
    return () => {
        running = false;
    };
};
