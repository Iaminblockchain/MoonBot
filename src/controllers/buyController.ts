import TelegramBot from "node-telegram-bot-api";
import { botInstance, getChatIdandMessageId, setState, STATE, setDeleteMessageId, getDeleteMessageId, trade, setTradeState } from "../bot";
import { SOLANA_CONNECTION } from "..";
import * as walletdb from "../models/walletModel";
import * as tradedb from "../models/tradeModel";
import * as positiondb from "../models/positionModel";
import * as solana from "../solana/trade";
import { logger } from "../logger";
import { getSolBalance } from "../solana/util";
import { getTokenMetaData } from "../solana/token";
import { PositionStatus } from "../models/positionModel";
import { parseTransaction } from "../solana/txhelpers";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { userFriendlyError } from "./common";

interface TradeSettings {
    amount: number;
    isPercentage: boolean;
    maxSlippage: number;
    takeProfit: number | null;
    repetitiveBuy: number;
    stopLoss: number | null;
    limitOrder?: Array<{
        price: number;
        percentage: number;
    }>;
}

const getBuySuccessMessage = async (
    trx: string,
    tokenAddress: string,
    trade_type: string,
    tokenBalanceChange: number,
    solBalanceChange: number,
    fees: number,
    settings?: {
        amount: number;
        isPercentage: boolean;
        maxSlippage: number;
        takeProfit: number | null;
        repetitiveBuy: number;
        stopLoss: number | null;
    },
    tradeSignal?: string
) => {
    const metaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);

    const tokenInfo = tokenBalanceChange ? `\nTokens bought: ${Math.abs(tokenBalanceChange).toLocaleString()}` : "";
    const solInfo = solBalanceChange ? `SOL Amount: ${Math.abs(solBalanceChange).toFixed(9)}` : "";
    const feesInfo = `Fees: ${fees.toFixed(9)} SOL`;
    const price = tokenBalanceChange ? Math.abs(solBalanceChange) / Math.abs(tokenBalanceChange) : 0;
    const priceInfo = `Price: ${price.toFixed(9)} SOL`;
    const sourceInfo = tradeSignal ? `Source: ${tradeSignal}` : "";

    let message = `${trade_type} successful\nTicker: ${metaData?.symbol}\n${solInfo}\n${feesInfo}\n${tokenInfo}\n${priceInfo}\n${sourceInfo}\n${trx}`;

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

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    try {
        const data = query.data;
        if (data == "buyController_start") {
            onBuyControlStart(query);
        } else if (data == "buyController_0.5buy") {
            onClickHalfBuy(query);
        } else if (data == "buyController_1.0buy") {
            onClickOneBuy(query);
        } else if (data == "buyController_Xbuy") {
            onClickXBuy(query);
        }
    } catch (error) {
        logger.error("handleCallBackQuery error", { error });
    }
};

export const onClickBuy = async (query: TelegramBot.CallbackQuery, amountSol: number): Promise<void> => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onClickBuy");
        return;
    }

    const { chatId } = getChatIdandMessageId(query);
    try {
        const wallet = await walletdb.getWalletByChatId(chatId!);
        const trade = await tradedb.getTradeByChatId(chatId!);
        if (!wallet || !trade) {
            logger.warn("onClickBuy skipped: missing wallet or trade", { chatId });
            return;
        }

        logger.info("onClickBuy initiated", { chatId, amountSol, token: trade.tokenAddress });
        await botInstance.sendMessage(chatId!, "Sending buy transaction");

        const amountlamports = amountSol * 10 ** 9;
        logger.info("call jupyter swap");
        const result = await solana.buy_swap(SOLANA_CONNECTION, wallet.privateKey, trade.tokenAddress, amountlamports);

        if (result.success) {
            const trxLink = result.txSignature ? `http://solscan.io/tx/${result.txSignature}` : "N/A";
            logger.info("result", { executionInfo: result });

            let tokenBalanceChange = result.token_balance_change;
            let sol_balance_change = result.sol_balance_change;

            logger.info("onClickBuy success", { chatId, txSignature: result.txSignature, tokenBalanceChange });

            const keypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
            const trxInfo = await parseTransaction(
                result.txSignature!,
                trade.tokenAddress,
                keypair.publicKey.toString(),
                SOLANA_CONNECTION
            );
            const msg = await getBuySuccessMessage(
                trxLink,
                trade.tokenAddress,
                "Buy",
                tokenBalanceChange,
                trxInfo.netBuySolAmount || 0,
                trxInfo.transactionFee || 0
            );
            botInstance.sendMessage(chatId!, msg);
        } else {
            logger.error("onClickBuy failed: not confirmed", { chatId, result });
            const errorMessage = userFriendlyError(result);
            await botInstance.sendMessage(chatId!, `Buy failed: ${errorMessage}`);
        }
    } catch (error: unknown) {
        logger.error("onClickBuy error", { error, chatId });
        const errorMessage = userFriendlyError(error);
        await botInstance.sendMessage(chatId!, errorMessage);
    }
};

// Specific handlers using the generic function
export const onClickHalfBuy = (query: TelegramBot.CallbackQuery) => onClickBuy(query, 0.5);
export const onClickOneBuy = (query: TelegramBot.CallbackQuery) => onClickBuy(query, 1);

const onClickXBuy = (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onClickXBuy");
        return;
    }

    const { chatId } = getChatIdandMessageId(query);
    setState(chatId!, STATE.INPUT_BUY_AMOUNT);
    botInstance.sendMessage(chatId!, "Input buy amount");
};

export const buyXAmount = async (message: TelegramBot.Message) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in buyXAmount");
        return;
    }

    try {
        const chatId = message.chat.id;

        const amount = parseFloat(message.text!);
        const wallet = await walletdb.getWalletByChatId(chatId);
        const trade = await tradedb.getTradeByChatId(chatId);
        if (wallet && trade) {
            botInstance.sendMessage(chatId, "Sending buy transaction");
            logger.info("Sending buy transaction:", { tokenAddress: trade.tokenAddress });

            let result = await solana.buy_swap(
                SOLANA_CONNECTION,
                wallet.privateKey,
                trade.tokenAddress,
                parseInt((amount * 10 ** 9).toString())
            );
            if (result.success) {
                logger.info(`confirmed ${result}`);
                let trx = "";
                if (result.txSignature) {
                    trx = `http://solscan.io/tx/${result.txSignature}`;
                }

                let tokenBalanceChange = result.token_balance_change;
                let sol_balance_change = result.sol_balance_change;

                const keypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
                const trxInfo = await parseTransaction(
                    result.txSignature!,
                    trade.tokenAddress,
                    keypair.publicKey.toString(),
                    SOLANA_CONNECTION
                );

                const msg = await getBuySuccessMessage(
                    trx,
                    trade.tokenAddress,
                    "Buy",
                    Number(tokenBalanceChange),
                    trxInfo.netBuySolAmount || 0,
                    trxInfo.transactionFee || 0
                );
                botInstance.sendMessage(chatId, msg);
            } else {
                logger.error(`buy failed ${result}`);
                const errorMessage = userFriendlyError(result);
                botInstance.sendMessage(chatId, `Buy failed: ${errorMessage}`);
            }
        }
    } catch (error: unknown) {
        logger.error("buyXAmount error", { error });
        const chatId = message.chat.id;
        const errorMessage = userFriendlyError(error);
        botInstance.sendMessage(chatId, errorMessage);
    }
};

export const showBuyPad = async (message: TelegramBot.Message) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in showBuyPad");
        return;
    }

    try {
        const chatId = message.chat.id;
        const tokenAddress = message.text;
        const metaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress!);
        const wallet = await walletdb.getWalletByChatId(chatId);
        const balance = await getSolBalance(wallet!.privateKey);
        const title = `<b>Buy</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${tokenAddress}</code>\n\nBalance: ${balance} SOL`;
        const buttons = [
            [
                { text: "Buy 0.5 SOL", callback_data: "buyController_0.5buy" },
                { text: "Buy 1.0 SOL", callback_data: "buyController_1.0buy" },
                { text: "Buy X SOL", callback_data: "buyController_Xbuy" },
            ],
            [{ text: "Refresh", callback_data: "buyController_refresh" }],
        ];
        botInstance.sendMessage(chatId, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: "HTML" });
        logger.info("buy info: ", { chatId, tokenAddress });
        await tradedb.createTrade(chatId, tokenAddress!);
        botInstance.deleteMessage(chatId, getDeleteMessageId(chatId));
    } catch (error) {
        logger.error("showBuyPad error", { error });
        const chatId = message.chat.id;
        botInstance.sendMessage(chatId, "Failed to display buy options");
    }
};

const onBuyControlStart = async (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onBuyControlStart");
        return;
    }

    try {
        const { chatId, messageId } = getChatIdandMessageId(query);
        setState(chatId!, STATE.INPUT_TOKEN);
        botInstance.sendMessage(chatId!, "Enter token address to buy.", { parse_mode: "HTML" }).then((message: TelegramBot.Message) => {
            const messageId = message.message_id;
            setDeleteMessageId(chatId!, messageId);
        });
    } catch (error) {
        logger.error("onClickTokenLaunchButton, error: ", { error });
    }
};

export type BuyTrade = {
    contract: string;
    buynumber: number;
};
export const buyTrades = new Map<string, BuyTrade[]>();

const getBuynumber = (chatId: string, contractAddress: string) => {
    const data = buyTrades.get(chatId);
    if (!data) return 0;
    else {
        const value = data.find((value) => value.contract === contractAddress);
        if (!value) return 0;
        else return value.buynumber;
    }
};

const AddBuynumber = (chatId: string, contractAddress: string) => {
    const data = buyTrades.get(chatId);
    if (!data) buyTrades.set(chatId, [{ contract: contractAddress, buynumber: 1 }]);
    else {
        const value = data.find((value) => value.contract === contractAddress);
        if (!value) buyTrades.set(chatId, [...data, { contract: contractAddress, buynumber: 1 }]);
        else {
            const others = data.filter((value) => value.contract != contractAddress);
            return buyTrades.set(chatId, [...others, { contract: contractAddress, buynumber: value.buynumber + 1 }]);
        }
    }
};

export const autoBuyContract = async (
    chatId: string,
    settings: {
        amount: number;
        isPercentage: boolean;
        maxSlippage: number;
        takeProfit: number | null;
        repetitiveBuy: number;
        stopLoss: number | null;
        limitOrder?: Array<{
            price: number;
            percentage: number;
        }>;
    },
    contractAddress: string,
    tradeSignal?: string
) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in autoBuyContract");
        return;
    }

    try {
        const wallet = await walletdb.getWalletByChatId(chatId);
        if (!wallet) {
            botInstance.sendMessage(chatId, "Wallet not found. Please create or import a wallet first.");
            return;
        }
        logger.info("run auto buy", { settings: settings, contractAddress: contractAddress, chatId: chatId });
        const balance = await getSolBalance(wallet.privateKey);
        let solAmount = settings.amount;
        if (settings.isPercentage) {
            solAmount = (balance * settings.amount) / 100;
        }
        if (solAmount > balance) {
            logger.error("Insufficient SOL balance", { chatId, balance, required: solAmount });
            botInstance.sendMessage(
                chatId,
                `❌ Insufficient SOL balance: you have ${balance.toFixed(9)} SOL but need ${solAmount.toFixed(9)} SOL.`
            );
            return;
        }

        const buyNumber = getBuynumber(chatId.toString(), contractAddress);
        if (buyNumber >= settings.repetitiveBuy) {
            logger.info("max repeat reached");
            return;
        }

        const metaData = await getTokenMetaData(SOLANA_CONNECTION, contractAddress);
        let trade_type = tradeSignal ? "CopyTrade buy" : "Auto-buy";
        logger.info(
            `${trade_type}: Sending buy transaction for Token  ${metaData?.name} (${metaData?.symbol}) : ${contractAddress} with amount ${solAmount} SOL ${tradeSignal ? `from signal @${tradeSignal} ` : ""}(Max Slippage: ${settings.maxSlippage}%)`
        );
        botInstance.sendMessage(
            chatId,
            `${trade_type}: Sending buy transaction for Token  ${metaData?.name} (${metaData?.symbol}) : ${contractAddress} with amount ${solAmount} SOL ${tradeSignal ? `from signal @${tradeSignal} ` : ""}(Max Slippage: ${settings.maxSlippage}%)`
        );

        let result = await solana.buy_swap(
            SOLANA_CONNECTION,
            wallet.privateKey,
            contractAddress,
            solAmount * 10 ** 9,
            settings.maxSlippage * 100
        );

        if (result.success) {
            let trx = result.txSignature ? `http://solscan.io/tx/${result.txSignature}` : "";
            let tokenBalanceChange = Number(result.token_balance_change);
            let solBalanceChange = Number(result.sol_balance_change);
            const keypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
            const trxInfo = await parseTransaction(result.txSignature!, contractAddress, keypair.publicKey.toString(), SOLANA_CONNECTION);

            const msg = await getBuySuccessMessage(
                trx,
                contractAddress,
                trade_type,
                tokenBalanceChange,
                trxInfo.netBuySolAmount || 0,
                trxInfo.transactionFee || 0,
                settings,
                tradeSignal
            );
            botInstance.sendMessage(chatId, msg);

            //TODO possbly in trade.ts
            // Save position information
            const position: positiondb.Position = {
                chatId,
                tokenAddress: contractAddress,
                signalSource: tradeSignal,
                buyPriceUsd: trxInfo.tokenUsdPrice || 0,
                buyPriceSol: trxInfo.tokenSolPrice || 0,
                stopLossPercentage: settings.stopLoss ? settings.stopLoss : 0,
                takeProfitPercentage: settings.takeProfit ? settings.takeProfit : 0,
                solAmount,
                tokenAmount: result.token_balance_change,
                soldTokenAmount: 0,
                soldTokenPercentage: 0,
                sellSteps: settings.limitOrder && settings.limitOrder.length > 0 ? [
                    ...settings.limitOrder.map(step => ({
                        targetPrice: trxInfo.tokenSolPrice! * (1 + (step.price || 0) / 100),
                        sellPercentage: step.percentage
                    })),
                ] : [
                    {
                        targetPrice: trxInfo.tokenSolPrice! * (1 - (settings.stopLoss || 0) / 100),
                        sellPercentage: 100
                    },
                    {
                        targetPrice: trxInfo.tokenSolPrice! * (1 + (settings.takeProfit || 0) / 100),
                        sellPercentage: 100
                    }
                ],
                soldSteps: [],
                buyTime: new Date(),
                status: PositionStatus.OPEN,
            };
            await positiondb.createPosition(position);

            if (settings.takeProfit != null && settings.stopLoss) {
                logger.info("set take profit");
                const splprice = trxInfo.tokenSolPrice || 0;
                // Calculate take profit and stop loss prices correctly
                const takeProfitPrice = splprice * (1 + settings.takeProfit / 100);
                const stopLossPrice = splprice * (1 - settings.stopLoss / 100);
                logger.info(`set TP ${takeProfitPrice} and SL ${stopLossPrice}`);

                // Format message based on whether limit order is active
                let message = `Auto-sell Registered!\n\n` +
                    `Token: <code>${contractAddress}</code>\n` +
                    `Current Price: ${splprice.toFixed(9)} SOL\n`;

                if (settings.limitOrder && settings.limitOrder.length > 0) {
                    message += `\nLimit Order Steps:\n`;
                    settings.limitOrder.forEach((step, index) => {
                        const targetPrice = splprice * (1 + step.price / 100);
                        message += `${index + 1}. ${targetPrice.toFixed(9)} SOL (${step.percentage}%)\n`;
                    });
                } else {
                    message += `Take Profit: ${takeProfitPrice.toFixed(9)} SOL (${settings.takeProfit}%)\n` +
                        `Stop Loss: ${stopLossPrice.toFixed(9)} SOL (${settings.stopLoss}%)`;
                }

                botInstance.sendMessage(chatId, message, { parse_mode: "HTML" });
                //set SL and TP in DB which will be queried
                setTradeState(
                    chatId, 
                    contractAddress, 
                    splprice, 
                    takeProfitPrice, 
                    stopLossPrice, 
                    solAmount,
                    0, // soldTokenAmount - initial value
                    0, // soldTokenPercentage - initial value
                    settings.limitOrder && settings.limitOrder.length > 0 ? 
                        settings.limitOrder.map(step => ({
                            targetPrice: splprice * (1 + step.price / 100),
                            sellPercentage: step.percentage
                        })) : 
                        [
                            {
                                targetPrice: stopLossPrice,
                                sellPercentage: 100
                            },
                            {
                                targetPrice: takeProfitPrice,
                                sellPercentage: 100
                            }
                        ],
                    [] // soldSteps - initial empty array
                );
                AddBuynumber(chatId.toString(), contractAddress);
            }
        } else {
            const errorMessage = result.error || "Buy failed due to an unknown error.";
            logger.error(`${trade_type} failed. result ${result}. Error: ${errorMessage}`);
            botInstance.sendMessage(chatId, `${trade_type} failed: ${errorMessage}`);
        }
    } catch (error) {
        logger.error(`autobuy error ${error}`, { chatId, settings, contractAddress, tradeSignal });
    }
};
