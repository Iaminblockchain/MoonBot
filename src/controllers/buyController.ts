import TelegramBot from "node-telegram-bot-api";
import { botInstance, setState, STATE, getChatIdandMessageId, setDeleteMessageId, getDeleteMessageId, removeState } from "../bot";
import { SOLANA_CONNECTION } from "../config";
import * as walletdb from "../models/walletModel";
import * as tradedb from "../models/tradeModel";
import * as solana from "../solana";
const { PublicKey } = require('@solana/web3.js'); // Import PublicKey

const onBuyControlStart = async (query: TelegramBot.CallbackQuery) => {
    try {
        const { chatId } = getChatIdandMessageId(query);
        setState(chatId!, STATE.INPUT_TOKEN);
        botInstance.sendMessage(chatId!, "Enter token address to buy.", { parse_mode: "HTML" })
            .then((message) => {
                setDeleteMessageId(chatId!, message.message_id);
            });
    } catch (error) {
        console.log("onBuyControlStart, error: " + error);
    }
};

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    try {
        const data = query.data;
        if (data === "buyController_start") {
            onBuyControlStart(query);
        } else if (data === "buyController_0.5buy") {
            onClickBuy(query, 0.5);
        } else if (data === "buyController_1.0buy") {
            onClickBuy(query, 1.0);
        } else if (data === "buyController_Xbuy") {
            onClickXBuy(query);
        }
    } catch (error) {
        console.log(error);
    }
};

const onClickBuy = async (query: TelegramBot.CallbackQuery, amount: number) => {
    const { chatId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);

    if (wallet && trade) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);

        botInstance.sendMessage(chatId!, `Sending buy transaction for ${amount} SOL`);
        
        const result = await solana.swapToken(
            SOLANA_CONNECTION,
            privateKey,
            publicKey,
            solana.WSOL_ADDRESS,
            trade.tokenAddress,
            amount,
            "ExactIn"
        );

        if (result.confirmed) {
            let trx = result.signature ? `http://solscan.io/tx/${result.signature}` : "";
            botInstance.sendMessage(chatId!, `Buy successful: ${trx}`);

            // Fetch token metadata & price
            const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, trade.tokenAddress);
            const entryPrice = await solana.getSolanaPrice(trade.tokenAddress);

            // Save trade in database
            await tradedb.createTrade(chatId!, metaData.symbol, trade.tokenAddress, amount, entryPrice);
        } else {
            botInstance.sendMessage(chatId!, "Buy failed");
        }
    }
};

const onClickXBuy = (query: TelegramBot.CallbackQuery) => {
    const { chatId } = getChatIdandMessageId(query);
    setState(chatId!, STATE.INPUT_BUY_AMOUNT);
    botInstance.sendMessage(chatId!, "Input buy amount");
};

export const buyXAmount = async (message: TelegramBot.Message) => {
    const chatId = message.chat.id;
    const amount = parseFloat(message.text!);
    console.log("input amount", amount);

    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);

    if (wallet && trade) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);

        botInstance.sendMessage(chatId!, `Sending buy transaction for ${amount} SOL`);
        
        const result = await solana.swapToken(
            SOLANA_CONNECTION,
            privateKey,
            publicKey,
            solana.WSOL_ADDRESS,
            trade.tokenAddress,
            amount,
            "ExactIn"
        );

        if (result.confirmed) {
            let trx = result.signature ? `http://solscan.io/tx/${result.signature}` : "";
            botInstance.sendMessage(chatId!, `Buy successful: ${trx}`);

            // Fetch token metadata & price
            const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, trade.tokenAddress);
            const entryPrice = await solana.getSolanaPrice(trade.tokenAddress);

            // Save trade in database
            await tradedb.createTrade(chatId!, metaData.symbol, trade.tokenAddress, amount, entryPrice);
        } else {
            botInstance.sendMessage(chatId!, "Buy failed");
        }
    }
};

export const showBuyPad = async (message: TelegramBot.Message) => {
    try {
        const chatId = message.chat.id;
        const tokenAddress = message.text!;
        const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
        const wallet = await walletdb.getWalletByChatId(chatId!);
        const balance = await solana.getSolBalance(wallet!.privateKey);

        const title = `<b>Buy</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${tokenAddress}</code>\n\nBalance: ${balance} SOL`;
        const buttons = [
            [{ text: "Buy 0.5 SOL", callback_data: "buyController_0.5buy" },
            { text: "Buy 1.0 SOL", callback_data: "buyController_1.0buy" },
            { text: "Buy X SOL", callback_data: "buyController_Xbuy" }]
        ];

        botInstance.sendMessage(chatId, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: "HTML" });
    } catch (error) {
        console.log(error);
    }
};
