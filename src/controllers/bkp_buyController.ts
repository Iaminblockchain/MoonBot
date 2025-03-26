import TelegramBot from "node-telegram-bot-api";
import { botInstance, switchMenu, getChatIdandMessageId, setState, STATE, setDeleteMessageId, getDeleteMessageId } from "../bot";
import { SOLANA_CONNECTION } from '..';
import * as walletdb from '../models/walletModel';
import * as tradedb from '../models/tradeModel';
import * as solana from '../solana';


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

    }

}

const onClickHalfBuy = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && trade) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey,  solana.WSOL_ADDRESS, trade.tokenAddress, 0.5 * solana.LAMPORTS, "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Buy successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Buy failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending buy transaction');
    }
}

const onClickOneBuy = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && trade) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);        
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey,  solana.WSOL_ADDRESS, trade.tokenAddress, 1 * solana.LAMPORTS, "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Buy successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Buy failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending buy transaction');
    }
}

const onClickXBuy = (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    setState(chatId!, STATE.INPUT_BUY_AMOUNT);
    botInstance.sendMessage(chatId!, 'Input buy amount');
}

export const buyXAmount = async (message: TelegramBot.Message) => {
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const amount = parseInt(message.text!);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && trade) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);        
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey,  solana.WSOL_ADDRESS, trade.tokenAddress, amount * solana.LAMPORTS, "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Buy successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Buy failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending buy transaction');
    }
}

export const showBuyPad = async (message: TelegramBot.Message) => {
    try {
        const chatId = message.chat.id;
        const messageId = message.message_id;
        const tokenAddress = message.text;
        const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, tokenAddress!);
        const wallet = await walletdb.getWalletByChatId(chatId);
        const balance = await solana.getSolBalance(wallet!.privateKey);
        const title = `<b>Buy</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${tokenAddress}</code>\n\nBalance: ${balance} SOL`
        const buttons = [
            [
                { text: 'Buy 0.5 SOL', callback_data: "buyController_0.5buy" },
                { text: 'Buy 1.0 SOL', callback_data: "buyController_1.0buy" },
                { text: 'Buy X SOL', callback_data: "buyController_Xbuy" }
            ],
            [
                { text: 'Refresh', callback_data: "buyController_refresh" }
            ]
        ]
        botInstance.sendMessage(chatId, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' })
        tradedb.createTrade(chatId, tokenAddress!);
        botInstance.deleteMessage(chatId, getDeleteMessageId(chatId));

    } catch (error) {

    }

}

const onBuyControlStart = async (query: TelegramBot.CallbackQuery) => {
    try {
        const { chatId, messageId } = getChatIdandMessageId(query);
        setState(chatId!, STATE.INPUT_TOKEN);
        botInstance.sendMessage(chatId!, 'Enter token address to buy.', { parse_mode: 'HTML' }).then((message) => {
            const messageId = message.message_id;
            setDeleteMessageId(chatId!, messageId!);
        });
    } catch (error) {
        console.log('onClickTokenLaunchButton, error: ' + error);
    }
}