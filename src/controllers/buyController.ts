import TelegramBot from "node-telegram-bot-api";
import { botInstance, getChatIdandMessageId, setState, STATE, setDeleteMessageId, getDeleteMessageId, setTradeState } from "../bot";
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
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { sendMessageToUser } from "../bot";
import { AutoBuySettings } from "./autoBuyController";
import { TRADE } from "../solana/types";

// Add minimum balance check
const MIN_SOL_BALANCE = 0.01;

interface TradeSettings {
    enabled: boolean;
    amount: number;
    isPercentage: boolean;
    maxSlippage: number;
    takeProfit: number | null;
    repetitiveBuy: number;
    stopLoss: number | null;
    limitOrders?: { priceIncreasement: number; sellPercentage: number }[];
}

const getBuySuccessMessage = async (
    trx: string,
    tokenAddress: string,
    trade_type: string,
    price: number,
    tokenBalanceChange: number,
    solBalanceChange: number,
    fees: number,
    timingMetrics?: {
        intervals: {
            priceCheckDuration: number;
            walletFetchDuration: number;
            balanceCheckDuration: number;
            swapDuration: number;
            metadataFetchDuration: number;
            messageSendDuration: number;
            totalDuration: number;
        };
    },
    settings?: AutoBuySettings,
    tradeSignal?: string
) => {
    const metaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);

    const tokenInfo = tokenBalanceChange ? `\nTokens bought: ${Math.abs(tokenBalanceChange).toLocaleString()}` : "";
    const solInfo = solBalanceChange ? `\nSOL Amount: ${Math.abs(solBalanceChange).toFixed(6)}` : "";
    const priceInfo = `Price: ${price.toFixed(9)} SOL`;
    const feesInfo = `\nFees: ${fees.toFixed(9)} SOL`;
    const sourceInfo = tradeSignal ? `Source: ${tradeSignal}` : "";

    let message = `${trade_type} successful\nTicker: ${metaData?.symbol}\n${priceInfo}\n${solInfo}\n${feesInfo}\n${tokenInfo}\n${sourceInfo}\n${trx}`;

    if (settings) {
        if (settings.takeProfit !== null) {
            message += `\nTake profit: ${settings.takeProfit}%`;
        }
        if (settings.stopLoss !== null) {
            message += `\nStop loss: ${settings.stopLoss}%`;
        }
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
        await sendMessageToUser(chatId!, "Sending buy transaction");

        const amountlamports = amountSol * 10 ** 9;
        logger.info("call jupyter swap");
        const result = await solana.buy_swap(SOLANA_CONNECTION, wallet.privateKey, trade.tokenAddress, amountlamports);

        if (result.success) {
            const trxLink = result.txSignature ? `http://solscan.io/tx/${result.txSignature}` : "N/A";
            logger.info("result", { executionInfo: result });

            let tokenBalanceChange = result.token_balance_change;
            let sol_balance_change = result.sol_balance_change;

            logger.info("onClickBuy success", { chatId, txSignature: result.txSignature, tokenBalanceChange, sol_balance_change });

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
                trxInfo.tokenSolPrice || 0,
                tokenBalanceChange,
                result.sol_balance_change,
                result.feesPaid,
                result.timingMetrics
            );
            await sendMessageToUser(chatId!, msg);
        } else {
            logger.error("onClickBuy failed: not confirmed", { chatId, result });
            await botInstance.sendMessage(chatId!, "Buy failed");
        }
    } catch (error: unknown) {
        logger.error("onClickBuy error", { error, chatId });
        const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        const reply =
            msg.includes("insufficient") || msg.includes("balance") ? "Buy failed: insufficient balance" : "Buy failed due to error";
        await sendMessageToUser(chatId!, reply);
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
    sendMessageToUser(chatId!, "Input buy amount").catch((err) => logger.error("Failed to send message", err));
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
            await sendMessageToUser(chatId, "Sending buy transaction");
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
                    trxInfo.tokenSolPrice || 0,
                    result.token_balance_change,
                    trxInfo.netBuySolAmount || 0,
                    trxInfo.transactionFee || 0,
                    result.timingMetrics
                );
                botInstance.sendMessage(chatId, msg);
            } else {
                logger.error(`buy failed ${result}`);
                botInstance.sendMessage(chatId, "Buy failed");
            }
        }
    } catch (error: unknown) {
        logger.error("buyXAmount error", { error });
        const chatId = message.chat.id;
        const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (msg.includes("insufficient") || msg.includes("balance")) {
            botInstance.sendMessage(chatId, "Buy failed: insufficient balance");
        } else {
            botInstance.sendMessage(chatId, "Buy failed due to error");
        }
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

export const autoBuyContract = async (chatId: string, settings: AutoBuySettings, contractAddress: string, tradeSignal?: string) => {
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

        if (balance < MIN_SOL_BALANCE) {
            logger.error("Balance too low", { chatId, balance, minimum: MIN_SOL_BALANCE });
            botInstance.sendMessage(
                chatId,
                `❌ Balance too low: you have ${balance.toFixed(6)} SOL but need at least ${MIN_SOL_BALANCE} SOL to trade.`
            );
            return;
        }

        if (solAmount > balance) {
            logger.error("Insufficient SOL balance", { chatId, balance, required: solAmount });
            botInstance.sendMessage(
                chatId,
                `❌ Insufficient SOL balance: you have ${balance.toFixed(6)} SOL but need ${solAmount.toFixed(6)} SOL.`
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
            `${trade_type}: Sending buy transaction for Token  ${metaData?.name}(${metaData?.symbol}) : ${contractAddress} with amount ${solAmount} SOL ${tradeSignal ? `from signal @${tradeSignal} ` : ""}(Max Slippage: ${settings.maxSlippage}%)`
        );
        botInstance.sendMessage(
            chatId,
            `${trade_type}: Sending buy transaction for Token  ${metaData?.name}(${metaData?.symbol}) : ${contractAddress} with amount ${solAmount} SOL ${tradeSignal ? `from signal @${tradeSignal} ` : ""}(Max Slippage: ${settings.maxSlippage}%)`
        );

        let result = await solana.buy_swap(
            SOLANA_CONNECTION,
            wallet.privateKey,
            contractAddress,
            solAmount * 10 ** 9,
            (settings.maxSlippage || 0) * 100
        );

        if (result.success) {
            let trx = result.txSignature ? `http://solscan.io/tx/${result.txSignature}` : "";
            let tokenBalanceChange = Number(result.token_balance_change);

            const keypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
            const trxInfo = await parseTransaction(result.txSignature!, contractAddress, keypair.publicKey.toString(), SOLANA_CONNECTION);

            const msg = await getBuySuccessMessage(
                trx,
                contractAddress,
                trade_type,
                trxInfo.tokenSolPrice || 0,
                tokenBalanceChange,
                result.sol_balance_change,
                result.feesPaid,
                result.timingMetrics
            );
            botInstance.sendMessage(chatId, msg);

            // Save position information
            logger.info("save position", { chatId, contractAddress, tradeSignal, settings });
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
                sellSteps: [],
                soldSteps: [],
                buyTime: new Date(),
                status: PositionStatus.OPEN,
            };
            const positionId = await positiondb.createPosition(position);

            // Set up sell steps based on limit orders or stop loss/take profit
            if (settings.limitOrderActive && settings.limitOrders && settings.limitOrders.length > 0) {
                // If limit orders are set, use them to create sell steps
                await positiondb.setSellSteps(chatId, contractAddress, settings.limitOrders, settings.stopLoss || undefined);
            } else {
                // If no limit orders, use stop loss and take profit
                await positiondb.setSellSteps(
                    chatId,
                    contractAddress,
                    undefined,
                    settings.stopLoss || undefined,
                    settings.takeProfit || undefined
                );
            }

            if (settings.takeProfit != null && settings.stopLoss != null) {
                logger.info("set take profit");
                // const price = result.execution_price;
                const keypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
                const price =
                    (await parseTransaction(result.txSignature || "", contractAddress, keypair.publicKey.toString(), SOLANA_CONNECTION))
                        .tokenSolPrice || 0;
                // Calculate take profit and stop loss prices
                const takeProfitPrice = price * (1 + settings.takeProfit / 100);
                const stopLossPrice = price * (1 - settings.stopLoss / 100);
                logger.info(`TRIGGER SET price ${price} set TP ${takeProfitPrice}  SL ${stopLossPrice}`);

                let message =
                    `Auto-sell Registered!\n\n` + `Token: <code>${contractAddress}</code>\n` + `Current Price: ${price.toFixed(9)} SOL\n`;

                if (settings.limitOrderActive && settings.limitOrders && settings.limitOrders.length > 0) {
                    message += `\nLimit Order Steps:\n`;
                    let cumulativePercentage = 0;
                    for (const order of settings.limitOrders) {
                        cumulativePercentage += order.sellPercentage;
                        const targetPrice = price * (1 + order.priceIncreasement / 100);
                        message += `• Sell ${order.sellPercentage}% at ${targetPrice.toFixed(9)} SOL (${order.priceIncreasement}%)\n`;
                    }
                    if (settings.stopLoss) {
                        message += `\nStop Loss: ${stopLossPrice.toFixed(9)} SOL (${settings.stopLoss}%)`;
                    }
                } else {
                    message +=
                        `Take Profit: ${takeProfitPrice.toFixed(9)} SOL (${settings.takeProfit}%)\n` +
                        `Stop Loss: ${stopLossPrice.toFixed(9)} SOL (${settings.stopLoss}%)`;
                }

                botInstance.sendMessage(chatId, message, { parse_mode: "HTML" });
                //set SL and TP in DB which will be queried
                const position = await positiondb.getPositionByTokenAddress(chatId, contractAddress);
                const tradeData: TRADE = {
                    contractAddress,
                    startPrice: price,
                    targetPrice: takeProfitPrice,
                    stopPrice: stopLossPrice,
                    totalTokenAmount: result.token_balance_change,
                    soldTokenAmount: 0,
                    soldTokenPercentage: 0,
                    sellSteps:
                        position?.sellSteps.map((step) => ({
                            targetPrice: price * (1 + step.priceIncreasement / 100),
                            sellPercentage: step.sellPercentage,
                        })) || [],
                    soldSteps: [],
                };
                setTradeState(chatId, contractAddress, price, tradeData);
                AddBuynumber(chatId.toString(), contractAddress);
            }
        } else {
            logger.error(`${trade_type} failed. result ${result}`);
            botInstance.sendMessage(chatId, `${trade_type} failed.`);
        }
    } catch (error) {
        logger.error(`autobuy error ${error}`, { chatId, settings, contractAddress, tradeSignal });
    }
};
