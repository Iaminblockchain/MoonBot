import TelegramBot from "node-telegram-bot-api";
import { botInstance, switchMenu, getChatIdandMessageId, setState, STATE, setDeleteMessageId, getDeleteMessageId } from "../bot";
import { SOLANA_CONNECTION } from '../config';
import * as walletdb from '../models/walletModel';
import * as tradedb from '../models/tradeModel';
import * as solana from '../solana';


export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    try {
        const data = query.data;
        if (data == "sellController_start") {
            showSellPad(query);
        } else if (data == "sellController_25%") {
            onClick25Sell(query);
        } else if (data == "sellController_50%") {
            onClick50Sell(query);
        } else if (data == "sellController_75%") {
            onClick75Sell(query);
        } else if (data == "sellController_100%") {
            onClick100Sell(query);
        }
    } catch (error) {

    }

}

const onClick25Sell = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && trade) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);
        const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey, publicKey, trade.tokenAddress, solana.WSOL_ADDRESS, 0.25 * Number(tokenBalance), "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Sell successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Sell failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending sell transaction');
    }
}

const onClick50Sell = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && trade) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);
        const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey, publicKey, trade.tokenAddress, solana.WSOL_ADDRESS, 0.5 * Number(tokenBalance), "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Sell successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Sell failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending sell transaction');
    }
}

const onClick75Sell = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && trade) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);
        const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey, publicKey, trade.tokenAddress, solana.WSOL_ADDRESS, 0.75 * Number(tokenBalance), "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Sell successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Sell failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending sell transaction');
    }
}

const onClick100Sell = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && trade) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);
        const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey, publicKey, trade.tokenAddress, solana.WSOL_ADDRESS, 1 * Number(tokenBalance), "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Sell successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Sell failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending sell transaction');
    }
}

export const showSellPad = async (query: TelegramBot.CallbackQuery) => {
    try {
        const { chatId, messageId } = getChatIdandMessageId(query);
        const trade = await tradedb.getTradeByChatId(chatId!);
        const wallet = await walletdb.getWalletByChatId(chatId!);
        if (trade && wallet) {
            const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, trade.tokenAddress);
            const publicKey = solana.getPublicKey(wallet.privateKey);
            const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
            const title = `<b>Sell</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${trade.tokenAddress}</code>\n\nBalance: ${Number(tokenBalance!) / (10 ** metaData!.decimals)} ${metaData!.symbol}`
            const buttons = [
                [
                    { text: 'Sell 25%', callback_data: "sellController_25%" },
                    { text: 'Sell 50%', callback_data: "sellController_50%" },
                    { text: 'Sell 75%', callback_data: "sellController_75%" },
                    { text: 'Sell 100%', callback_data: "sellController_100%" }
                ],
                [
                    { text: 'Refresh', callback_data: "sellController_refresh" }
                ]
            ]
            botInstance.sendMessage(chatId!, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' })
        }
    } catch (error) {

    }
}