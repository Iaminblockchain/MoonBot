import TelegramBot from 'node-telegram-bot-api';
import * as config from './config';
import * as db from './db';
import * as solana from './solana';
import * as walletDb from './models/walletModel';
import * as buyController from './controllers/buyController';
import * as sellController from './controllers/sellController';
import * as walletController from './controllers/walletController';
import * as settingController from './controllers/settingController';
import * as positionController from './controllers/positionController';
import * as autoBuyController from './controllers/autoBuyController';
import * as helpController from './controllers/helpController';
import * as copytradeController from './controllers/copytradeController';

import cron from "node-cron";

export const botInstance = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });

export const enum STATE {
    INPUT_TOKEN,
    INPUT_BUY_AMOUNT,
    INPUT_PRIVATE_KEY
};

export type TRADE = {
    contractAddress : string,
    targetPrice : number,
    lowPrice: number,
}

export const state = new Map();
export const deleteMessageId = new Map();
export const trade = new Map<string, TRADE[]>();

export const setDeleteMessageId = (chatId: TelegramBot.ChatId, messageId: number) => {
    deleteMessageId.set(chatId.toString(), messageId);
};

export const getDeleteMessageId = (chatId: TelegramBot.ChatId) => {
    return deleteMessageId.get(chatId.toString());
};

export const setState = (chatid: TelegramBot.ChatId, newState: number, data = {}) => {
    state.set(chatid.toString(), { state: newState, data });
};
export const getState = (chatid: TelegramBot.ChatId) => {
    return state.get(chatid.toString());
};

export const removeState = (chatid: TelegramBot.ChatId) => {
    state.delete(chatid.toString());
};
export const clearState = () => {
    state.clear();
};

export const setTradeState = (chatid: TelegramBot.ChatId, contractAddress: string, targetPrice: number, lowPrice: number) => {
    const prev = trade.get(chatid.toString())
    if(prev) trade.set(chatid.toString(), [...prev, {contractAddress, targetPrice, lowPrice}]);
    else trade.set(chatid.toString(), [{contractAddress, targetPrice, lowPrice}]);
}; 

export const removeTradeState = (chatid: TelegramBot.ChatId, contractAddress: string) => {
    const prev = trade.get(chatid.toString())
    if(!prev) return;
    const next = prev.filter((value: TRADE) => value.contractAddress !== contractAddress)
    trade.set(chatid.toString(), [...next]);
}; 

export const init = () => {
    botInstance.setMyCommands(
        [
            { command: 'start', description: 'Start bot' },
            { command: 'wallet', description: 'Manage wallet' },
            { command: 'help', description: 'Show help' },
            { command: 'autobuy', description: 'Auto Buy settings' },
        ],
    );

    botInstance.onText(/\/start/, onStartCommand);
    botInstance.onText(/\/wallet/, onWalletCommand);
    botInstance.onText(/\/help/, onHelpCommand);
    botInstance.onText(/\/autobuy/, autoBuyController.onAutoBuyCommand);

    runAutoSellSchedule();

    botInstance.on('message', async (msg: TelegramBot.Message) => {
        const chatId = msg.chat.id;
        const messageId = msg.message_id;
        const messageText = msg.text;
        if (!msg.text!.startsWith('/')) {
            const currentState = getState(chatId.toString());
            if (currentState) {
                if (currentState.state == STATE.INPUT_TOKEN) {
                    removeState(chatId);
                    buyController.showBuyPad(msg);
                } else if (currentState.state == STATE.INPUT_BUY_AMOUNT) {
                    removeState(chatId);
                    buyController.buyXAmount(msg);
                } else if (currentState.state == STATE.INPUT_PRIVATE_KEY) {
                    walletController.handlePrivateKey(msg);
                }
            } else {
                // No active state: check if auto-buy is enabled and the message is a contract address.
                autoBuyController.checkAutoBuy(msg);
            }
        }
        //  else if () {

        // }
    });

    botInstance.on('callback_query', (query) => {
        try {
            const chatId = query.message!.chat.id;
            const data = query.data;
            console.log(`callback, chatId = ${chatId}, data = ${data}`);
            if (data?.startsWith("buyController_")) {
                buyController.handleCallBackQuery(query);
            } else if(data?.startsWith("ct_")){
                copytradeController.handleCallBackQuery(query);
            } else if (data?.startsWith("sc_")) {
                sellController.handleCallBackQuery(query);
            } else if (data?.startsWith("walletController_")) {
                walletController.handleCallBackQuery(query);
            } else if (data?.startsWith("settingController_")) {
                settingController.handleCallBackQuery(query);
            } else if (data?.startsWith("positionController_")) {
                positionController.handleCallBackQuery(query);
            } else if (data?.startsWith("autoBuyController_")) {
                autoBuyController.handleCallBackQuery(query);
            } else if (data?.startsWith("helpController_")) {
                helpController.handleCallBackQuery(query);
            } else if (data?.startsWith("back_start")) {
                backToStart(query);
            } else if (data?.startsWith("close")) {
                closeMessage(query);
            }
        } catch (error) {
            console.log(error);
        }
    });
};

export const runAutoSellSchedule = () => {
    const scheduler = "*/5 * * * * *"; // every 5 seconds
    try {
      cron
        .schedule(scheduler, () => {
          sellController.autoSellHandler()
        })
        .start();
    } catch (error) {
      console.error(`Error running the Schedule Job for Auto Sell: ${error}`);
    }
  };

const closeMessage = (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    botInstance.deleteMessage(chatId!, messageId!);
};

export const getChatIdandMessageId = (query: TelegramBot.CallbackQuery) => {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    return { chatId, messageId };
};

export async function switchMenu(chatId: TelegramBot.ChatId, messageId: number | undefined, title: string, json_buttons: any) {
    const keyboard = {
        inline_keyboard: json_buttons,
        resize_keyboard: true,
        one_time_keyboard: true,
        force_reply: true
    };

    try {
        await botInstance.editMessageText(title, { chat_id: chatId, message_id: messageId, reply_markup: keyboard, disable_web_page_preview: true, parse_mode: 'HTML' });
    } catch (error) {
        console.log(error);
    }
}

const onStartCommand = async (msg: TelegramBot.Message) => {
    console.log('user:', msg.chat.username);
    const { title, buttons } = await getTitleAndButtons(msg.chat.id);
    botInstance.sendMessage(msg.chat.id, title, {
        reply_markup: {
            inline_keyboard: buttons,
        },
        parse_mode: 'HTML'
    });
};

const onWalletCommand = (msg: TelegramBot.Message) => {
    // Implement wallet command handling if needed.
};

const onHelpCommand = (msg: TelegramBot.Message) => {
    // Implement help command handling if needed.
};

const backToStart = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const { title, buttons } = await getTitleAndButtons(chatId!);
    switchMenu(chatId!, messageId!, title, buttons);
};

const getTitleAndButtons = async (chatId: TelegramBot.ChatId) => {
    const wallet = await walletDb.getWalletByChatId(chatId);
    let walletInfo;
    if (!wallet) {
        walletInfo = "You currently have no wallet. To start trading, create or import a wallet and deposit SOL to your wallet";
    } else {
        const balance = await solana.getSolBalance(wallet.privateKey);
        const publicKey = solana.getPublicKey(wallet.privateKey);
        walletInfo = `Address: <code>${publicKey}</code> \nBalance: ${balance} SOL`;
    }
    return {
        title: `<b>Welcome to MoonBot</b> \n\nSolana's fastest bot to trade any coin (SPL token), built by the MoonBot community! \n\n${walletInfo}`,
        buttons: [
            [
                { text: 'Buy', callback_data: "buyController_start" },
                { text: 'Sell', callback_data: "sc_start" }
            ],
            [
                { text: 'Positions', callback_data: "positionController_start" },
                { text: 'Limit Orders', callback_data: "limitOrderController_start" }
            ],
            [
                { text: 'Copy Trade', callback_data: "ct_start" },
                { text: 'Autobuy', callback_data: "autoBuyController_start" }
            ],
            [
                { text: 'Referrals', callback_data: "referralController_start" },
                { text: 'Settings', callback_data: "settingController_start" }
            ],
            [
                { text: 'Wallet', callback_data: "walletController_start" }
            ],
            [
                { text: 'Help', callback_data: "helpController_start" },
                { text: 'Refresh', callback_data: "Refresh" }
            ]
        ]
    };
};

