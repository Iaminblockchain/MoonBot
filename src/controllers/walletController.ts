import TelegramBot, { CallbackQuery } from "node-telegram-bot-api";
import * as walletdb from '../models/walletModel';
import * as solana from '../solana/trade';
import { botInstance, getChatIdandMessageId, setState, getState, switchMenu, STATE } from "../bot";
import { logger } from "../logger";
import { getPublicKey, createWallet, getSolBalance } from "../solana/util"

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    try {
        const data = query.data;
        if (data == "walletController_start") {
            walletManageStart(query);
        } else if (data == "walletController_create") {
            createWalletCall(query);
        } else if (data == "walletController_import") {
            importWallet(query);
        } else if (data == 'walletController_refresh') {
            refreshWallet(query);
        } else if (data == 'walletController_privateKey') {
            showPrivateKey(query);
        }
    } catch (error) {
        logger.error("handleCallBackQuery error:", error);
    }
}

const showPrivateKey = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    botInstance.sendMessage(
        chatId!,
        `🚨 <b>WARNING: Never share your private key!</b> 🚨\n\n<code>${wallet!.privateKey}</code>`,
        { reply_markup: { inline_keyboard: [[{ text: 'Close', callback_data: "close" }]] }, parse_mode: 'HTML' }
    );
}

const refreshWallet = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const walletInfo = await getWalletInfoAndButtons(chatId!);
    if (walletInfo) {
        switchMenu(chatId!, messageId, walletInfo.title, walletInfo.buttons);
    }
}

const getWalletInfoAndButtons = async (chatId: TelegramBot.ChatId) => {
    try {
        const wallet = await walletdb.getWalletByChatId(chatId!);
        if (wallet == null) {
            const title = '<b>You currently have no wallet.</b>\n\nTo start trading, create or import a wallet and deposit SOL to your wallet';
            const buttons = [
                [
                    { text: 'Create', callback_data: "walletController_create" },
                    { text: 'Import', callback_data: "walletController_import" }
                ]
            ];
            return { title, buttons };
        } else {
            const address = getPublicKey(wallet?.privateKey!);
            const balance = await getSolBalance(wallet.privateKey);
            const title = `<b>Your Wallet:</b>\n\nAddress: <code>${address}</code>\nBalance:<b> ${balance}</b> SOL\n\nTap to copy the address and send SOL to deposit.`;
            const buttons = [
                [
                    { text: 'PrivateKey', callback_data: "walletController_privateKey" },
                    { text: 'Refresh', callback_data: "walletController_refresh" }
                ],
                [
                    { text: 'Close', callback_data: "close" }
                ]
            ];
            return { title, buttons };
        }
    } catch (error) {
        logger.error('getWalletInfoAndButtons error:', error);
        return null;
    }
}

const createWalletCall = async (query: TelegramBot.CallbackQuery) => {
    try {
        const chatId = query.message?.chat.id;
        const messageId = query.message?.message_id;
        const wallet = await walletdb.getWalletByChatId(chatId!);
        const { publicKey, privateKey } = createWallet();
        await walletdb.createWallet(chatId!, privateKey);
        const walletinfo = await getWalletInfoAndButtons(chatId!);
        if (walletinfo) {
            switchMenu(chatId!, messageId, walletinfo.title, walletinfo.buttons);
        }
    } catch (error) {
        logger.error('createWallet error:', error);
    }
}

const importWallet = async (query: TelegramBot.CallbackQuery) => {
    try {
        const { chatId, messageId } = getChatIdandMessageId(query);
        botInstance.sendMessage(chatId!, 'Input private key:');
        setState(chatId!, STATE.INPUT_PRIVATE_KEY, { messageId });
    } catch (error) {
        logger.error("importWallet error:", error);
    }
}

export const handlePrivateKey = async (msg: TelegramBot.Message) => {
    try {
        const chatId = msg.chat.id;
        const messageId = msg.message_id;
        const privateKey = msg.text;
        const stateData = getState(chatId!);
        const beforeMessageId = stateData?.data?.messageId;
        await walletdb.createWallet(chatId!, privateKey!);
        const walletinfo = await getWalletInfoAndButtons(chatId!);
        if (walletinfo && beforeMessageId !== undefined) {
            switchMenu(chatId!, beforeMessageId, walletinfo.title, walletinfo.buttons);
            botInstance.deleteMessage(chatId, messageId);
        }
    } catch (error) {
        logger.error("handlePrivateKey error:", error);
    }
}

const walletManageStart = async (query: TelegramBot.CallbackQuery) => {
    const chatId = query.message?.chat.id;
    const walletInfo = await getWalletInfoAndButtons(chatId!);
    if (walletInfo) {
        botInstance.sendMessage(chatId!, walletInfo.title, { reply_markup: { inline_keyboard: walletInfo.buttons! }, parse_mode: 'HTML' });
    }
}
