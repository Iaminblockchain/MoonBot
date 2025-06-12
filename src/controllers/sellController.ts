import TelegramBot from "node-telegram-bot-api";
import { botInstance, getChatIdandMessageId, sendMessageToUser } from "../bot";
import { SOLANA_CONNECTION } from "..";
import * as walletdb from "../models/walletModel";
import * as positiondb from "../models/positionModel";
import * as solana from "../solana/trade";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
const { PublicKey } = require("@solana/web3.js"); // Import PublicKey
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { logger } from "../logger";
import { getTokenMetaData } from "../solana/token";
import { parseTransaction } from "../solana/txhelpers";
import { closePosition } from "../models/positionModel";
import { formatPrice } from "../solana/util";
import { sendMessageToUser as botUtilsSendMessageToUser } from "../botUtils";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in sellController.handleCallBackQuery");
        return;
    }

    try {
        const data = query.data;
        if (data == "sc_start") {
            showSellPad(query);
        } else if (data && data.includes("sc_25%_")) {
            onClick25Sell(query);
        } else if (data && data.includes("sc_50%_")) {
            onClick50Sell(query);
        } else if (data && data.includes("sc_75%_")) {
            onClick75Sell(query);
        } else if (data && data.includes("sc_100%_")) {
            onClick100Sell(query);
        } else if (data && data.includes("sc_t_")) {
            onClickSellWithToken(query);
        }
    } catch (error) {
        logger.error("Error in handleCallBackQuery", { error });
    }
};

// Generic sell handler: sells a fraction of the user's token balance.
const onClickSell = async (query: TelegramBot.CallbackQuery, fraction: number, wrapUnwrapSOL: boolean = false): Promise<void> => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onClickSell");
        return;
    }

    const { chatId } = getChatIdandMessageId(query);
    logger.info("onClickSell called", { chatId, fraction, wrapUnwrapSOL });

    const wallet = await walletdb.getWalletByChatId(chatId!);
    if (!wallet || !query.data) {
        logger.warn("Wallet or query data missing", { chatId });
        return;
    }

    const privateKey = wallet.privateKey;
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const [, , tokenAddress] = query.data.split("_");

    const tokenATA = getAssociatedTokenAddressSync(new PublicKey(tokenAddress), keypair.publicKey);
    const tokenBalance = await SOLANA_CONNECTION.getTokenAccountBalance(tokenATA);
    const amountToSell = fraction * Number(tokenBalance.value.amount);

    logger.info("Preparing to send transaction", { tokenAddress, amountToSell });
    await sendMessageToUser(chatId!, "Sending sell transaction");

    try {
        const result = await solana.sell_swap(SOLANA_CONNECTION, privateKey, tokenAddress, amountToSell);
        if (result.success) {
            logger.info("Sell transaction result", { result });
            let tokenBalanceChange = Number(result.token_balance_change);
            let sol_balance_change = Number(result.sol_balance_change);

            const trxLink = result.txSignature ? `http://solscan.io/tx/${result.txSignature}` : "N/A";

            const msg = await getSellSuccessMessage(trxLink, tokenAddress, sol_balance_change, tokenBalanceChange, "Sell");
            await sendMessageToUser(chatId!, msg);

            // Get current price for closing position
            const wallet = await walletdb.getWalletByChatId(chatId!.toString());
            if (!wallet) {
                throw new Error("Wallet not found");
            }
            const walletPublicKey = getPublicKeyinFormat(wallet.privateKey).toString();
            const trxInfo = await parseTransaction(result.txSignature!, tokenAddress, walletPublicKey, SOLANA_CONNECTION);
            if (!trxInfo.tokenSolPrice || !trxInfo.tokenUsdPrice) {
                throw new Error("Failed to get token prices from transaction");
            }

            const position = await positiondb.getPositionByTokenAddress(chatId!.toString(), tokenAddress);
            if (!position) {
                throw new Error("Position not found");
            }

            const tokenMetaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
            if (!tokenMetaData) {
                throw new Error("Token metadata not found");
            }

            // Calculate token amount with decimals
            const tokenAmount = position.tokenAmount / Math.pow(10, tokenMetaData.decimals);

            await closePosition(chatId!.toString(), tokenAddress, trxInfo.tokenUsdPrice, trxInfo.tokenSolPrice);

            const profitLoss = (trxInfo.tokenSolPrice - position.buyPriceSol) * position.solAmount;
            const profitLossPercentage = (((trxInfo.tokenSolPrice - position.buyPriceSol) / position.buyPriceSol) * 100).toFixed(2);
            const profitLossText = profitLoss >= 0 ? "Profit" : "Loss";

            const message =
                `✅ <b>Position Closed Successfully!</b>\n\n` +
                `Token: ${tokenMetaData.symbol} (${tokenMetaData.name})\n` +
                `Price: ${formatPrice(result.execution_price || 0)}\n` +
                `Price USD: ${formatPrice(result.execution_price_usd || 0)}\n` +
                `Amount Sold: ${tokenAmount} ${tokenMetaData.symbol}\n` +
                `Buy Price: ${position.buyPriceSol?.toFixed(9) || "0"} SOL ($${position.buyPriceUsd?.toFixed(6) || "0"})\n` +
                `Sell Price: ${trxInfo.tokenSolPrice.toFixed(9)} SOL ($${trxInfo.tokenUsdPrice.toFixed(6)})\n` +
                `${profitLossText}: ${Math.abs(profitLoss).toFixed(6)} SOL (${profitLossPercentage}%)\n` +
                `Transaction: http://solscan.io/tx/${result.txSignature}`;

            await sendMessageToUser(chatId!, message, { parse_mode: "HTML" });
        } else {
            logger.error("Sell transaction failed", { result });
            await sendMessageToUser(chatId!, "Sell failed");
        }
    } catch (error: unknown) {
        logger.error("Sell error", { error });
        const errorMessage = error instanceof Error ? error.message : String(error);
        await sendMessageToUser(chatId!, `Sell error: ${errorMessage}`);
    }
};

// Specific percentage handlers:
export const onClick25Sell = async (query: TelegramBot.CallbackQuery): Promise<void> => onClickSell(query, 0.25, true);

export const onClick50Sell = async (query: TelegramBot.CallbackQuery): Promise<void> => onClickSell(query, 0.5);

export const onClick75Sell = async (query: TelegramBot.CallbackQuery): Promise<void> => onClickSell(query, 0.75);

export const onClick100Sell = async (query: TelegramBot.CallbackQuery): Promise<void> => onClickSell(query, 1);

// export const showSellPad = async (query: TelegramBot.CallbackQuery) => {
//     try {
//         const { chatId, messageId } = getChatIdandMessageId(query);
//         const trade = await tradedb.getTradeByChatId(chatId!);
//         const wallet = await walletdb.getWalletByChatId(chatId!);
//         if (trade && wallet) {
//             const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, trade.tokenAddress);
//             const publicKey = solana.getPublicKey(wallet.privateKey);
//             const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
//             const title = `<b>Sell</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${trade.tokenAddress}</code>\n\nBalance: ${Number(tokenBalance!) / (10 ** metaData!.decimals)} ${metaData!.symbol}`
//             const buttons = [
//                 [
//                     { text: 'Sell 25%', callback_data: "sc_25%" },
//                     { text: 'Sell 50%', callback_data: "sc_50%" },
//                     { text: 'Sell 75%', callback_data: "sc_75%" },
//                     { text: 'Sell 100%', callback_data: "sc_100%" }
//                 ],
//                 [
//                     { text: 'Refresh', callback_data: "sc_refresh" }
//                 ]
//             ]
//             botInstance.sendMessage(chatId!, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' })
//         }
//     } catch (error) {

//     }
// }

export const getPublicKeyinFormat = (privateKey: string) => {
    // Decode the base58 private key into Uint8Array
    const secretKeyUint8Array = new Uint8Array(bs58.decode(privateKey));

    // Create a Keypair from the secret key
    const keypair = Keypair.fromSecretKey(secretKeyUint8Array);

    // Return the public key as a string
    return keypair.publicKey;
};

export const showSellPad = async (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in showSellPad");
        return;
    }

    try {
        const { chatId } = getChatIdandMessageId(query);
        const wallet = await walletdb.getWalletByChatId(chatId!);

        if (!wallet) {
            await sendMessageToUser(chatId!, "❌ No wallet found. Please connect a wallet first.");
            return;
        }

        const publicKey = getPublicKeyinFormat(wallet.privateKey);

        // Fetch all tokens in the wallet
        const tokenAccounts = await solana.getAllTokensWithBalance(SOLANA_CONNECTION, publicKey);

        if (!tokenAccounts || tokenAccounts.length === 0) {
            await sendMessageToUser(chatId!, "⚠️ No tokens found in your wallet.");
            return;
        }
        // Generate buttons for each token
        const buttons = tokenAccounts.map((token) => [
            { text: `Sell ${token.symbol} (${token.balance})`, callback_data: `sc_t_${token.address}` },
        ]);

        const title = `<b>Your Tokens</b>\nSelect a token to sell:`;

        await sendMessageToUser(chatId!, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: "HTML" });
    } catch (error) {
        logger.error("Error in showSellPad:", error);
        if (botInstance && query.message) {
            await sendMessageToUser(query.message.chat.id, "❌ Failed to fetch wallet tokens.");
        }
    }
};

export const onClickSellWithToken = async (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onClickSellWithToken");
        return;
    }

    try {
        const { chatId, messageId } = getChatIdandMessageId(query);
        // const trade = await tradedb.getTradeByChatId(chatId!);
        const wallet = await walletdb.getWalletByChatId(chatId!);
        if (query && query.data && wallet) {
            let queryData = query.data.split("_");
            const token = queryData[2];
            const buttons = [
                [
                    { text: "Sell 25%", callback_data: `sc_25%_${token}` },
                    { text: "Sell 50%", callback_data: `sc_50%_${token}` },
                    { text: "Sell 75%", callback_data: `sc_75%_${token}` },
                    { text: "Sell 100%", callback_data: `sc_100%_${token}` },
                ],
                [{ text: "Refresh", callback_data: "sc_refresh" }],
            ];
            await sendMessageToUser(chatId!, `Selling ${token}. Select percentage`, {
                reply_markup: { inline_keyboard: buttons },
                parse_mode: "HTML",
            });
        }
        // if (trade && wallet) {
        //     const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, trade.tokenAddress);
        //     const publicKey = solana.getPublicKey(wallet.privateKey);
        //     const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
        //     const title = `<b>Sell</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${trade.tokenAddress}</code>\n\nBalance: ${Number(tokenBalance!) / (10 ** metaData!.decimals)} ${metaData!.symbol}`
        //     const buttons = [
        //         [
        //             { text: 'Sell 25%', callback_data: "sc_25%" },
        //             { text: 'Sell 50%', callback_data: "sc_50%" },
        //             { text: 'Sell 75%', callback_data: "sc_75%" },
        //             { text: 'Sell 100%', callback_data: "sc_100%" }
        //         ],
        //         [
        //             { text: 'Refresh', callback_data: "sc_refresh" }
        //         ]
        //     ]
        //     botInstance.sendMessage(chatId!, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' })
        // }
    } catch (error) {}
};

const getSellSuccessMessage = async (
    trx: string,
    tokenAddress: string,
    solAmount: number,
    tokenBalanceChange: number,
    trade_type: string,
    settings?: {
        amount: number;
        isPercentage: boolean;
        maxSlippage: number;
        takeProfit: number | null;
        repetitiveBuy: number;
        stopLoss: number | null;
    },
    tradeSignal?: string,
    timingMetrics?: {
        intervals: {
            priceCheckDuration: number;
            walletFetchDuration: number;
            balanceCheckDuration: number;
            swapDuration: number;
            metadataFetchDuration: number;
            messageSendDuration: number;
            totalDuration: number;
            txSubmitDuration: number;
            txConfirmDuration: number;
        };
    }
) => {
    const metaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);

    const tokenInfo = tokenBalanceChange ? `\nTokens sold: ${Math.abs(tokenBalanceChange).toLocaleString()}` : "";
    const solInfo = solAmount ? `\nSOL Amount: ${Math.abs(solAmount).toFixed(6)}` : "";
    const sourceInfo = tradeSignal ? `Source: ${tradeSignal}` : "";
    const timingInfo = timingMetrics
        ? `\nTiming:\n` +
          `Total: ${timingMetrics.intervals.totalDuration}ms\n` +
          `Swap: ${timingMetrics.intervals.swapDuration}ms\n` +
          `Wallet: ${timingMetrics.intervals.walletFetchDuration}ms\n` +
          `Balance: ${timingMetrics.intervals.balanceCheckDuration}ms`
        : "";

    let message = `${trade_type} successful\nTicker: ${metaData?.symbol}\n${solInfo}\n${tokenInfo}\n${sourceInfo}\n${timingInfo}\n${trx}`;

    if (settings) {
        if (settings.takeProfit !== null) {
            message += `\nTake profit: ${settings.takeProfit}%`;
        }
        if (settings.stopLoss !== null) {
            message += `\nStop loss: ${settings.stopLoss}%`;
        }
    }

    return message;
};
