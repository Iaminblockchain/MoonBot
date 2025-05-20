import { TELEGRAM_BOT_TOKEN } from ".";
import TelegramBot from "node-telegram-bot-api";
import * as solana from "./solana/trade";
import * as walletDb from "./models/walletModel";
import * as buyController from "./controllers/buyController";
import * as sellController from "./controllers/sellController";
import * as walletController from "./controllers/walletController";
import * as withdrawController from "./controllers/withdrawController";
import * as settingController from "./controllers/settingController";
import * as portfolioController from "./controllers/portfolioController";
import * as autoBuyController from "./controllers/autoBuyController";
import * as helpController from "./controllers/helpController";
import * as copytradeController from "./controllers/copytradeController";
import * as referralController from "./controllers/referralController";
import * as positionController from "./controllers/positionController";
import { TelegramClient } from "telegram";
import { logger } from "./logger";
import { getSolBalance, getPublicKey } from "./solana/util";

import cron from "node-cron";
import { createReferral, getReferralByRefereeId } from "./models/referralModel";
import { helpText } from "./util/constants";
import { handleReferralWalletMessage } from "./controllers/referralController";

export let botInstance: TelegramBot | undefined;

export enum STATE {
    MAIN_MENU = "MAIN_MENU",
    SETTING_WALLET = "SETTING_WALLET",
    SETTING_REFERRAL_WALLET = "SETTING_REFERRAL_WALLET",
    INPUT_TOKEN = "INPUT_TOKEN",
    INPUT_BUY_AMOUNT = "INPUT_BUY_AMOUNT",
    INPUT_PRIVATE_KEY = "INPUT_PRIVATE_KEY",
    INPUT_COPYTRADE = "INPUT_COPYTRADE",
    COPYTRADE_INPUT = "COPYTRADE_INPUT",
}

export type TRADE = {
    contractAddress: string;
    startPrice: number;
    targetPrice: number;
    lowPrice: number;
};

export const state = new Map();
export const deleteMessageId = new Map();
export const trade = new Map<string, TRADE[]>();

export const setDeleteMessageId = (chatId: TelegramBot.ChatId, messageId: number) => {
    deleteMessageId.set(chatId.toString(), messageId);
};

export const getDeleteMessageId = (chatId: TelegramBot.ChatId) => {
    return deleteMessageId.get(chatId.toString());
};

export const setState = (chatid: TelegramBot.ChatId, newState: STATE, data = {}) => {
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

export const setTradeState = (
    chatid: TelegramBot.ChatId,
    contractAddress: string,
    startPrice: number,
    targetPrice: number,
    lowPrice: number
) => {
    const prev = trade.get(chatid.toString());
    if (prev) trade.set(chatid.toString(), [...prev, { contractAddress, targetPrice, lowPrice, startPrice }]);
    else trade.set(chatid.toString(), [{ contractAddress, targetPrice, lowPrice, startPrice }]);
};

export const removeTradeState = (chatid: TelegramBot.ChatId, contractAddress: string) => {
    const prev = trade.get(chatid.toString());
    if (!prev) return;
    const next = prev.filter((value: TRADE) => value.contractAddress !== contractAddress);
    trade.set(chatid.toString(), [...next]);
};

interface CallbackQueryData extends TelegramBot.CallbackQuery {
    message?: TelegramBot.Message & {
        chat: {
            id: number;
        };
    };
}

export const init = (client: TelegramClient) => {
    copytradeController.setClient(client);

    logger.info("TGbot: init TG bot with token");
    botInstance = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    botInstance
        .getMe()
        .then((botInfo: TelegramBot.User) => {
            logger.info(`Bot name: ${botInfo.username}`);
        })
        .catch((error: Error) => {
            logger.error("Error getting bot info:", { error: error.message });
        });
    botInstance.setMyCommands([
        { command: "start", description: "Start bot" },
        // { command: 'wallet', description: 'Manage wallet' },
        { command: "help", description: "Show help" },
        { command: "autobuy", description: "Auto Buy settings" },
    ]);

    botInstance.onText(/\/start(?: (.+))?/, onStartCommand);
    botInstance.onText(/\/wallet/, onWalletCommand);
    botInstance.onText(/\/help/, onHelpCommand);
    botInstance.onText(/\/autobuy/, autoBuyController.onAutoBuyCommand);

    runAutoSellSchedule();

    botInstance.on("message", async (msg: TelegramBot.Message) => {
        const chatId = msg.chat.id;
        const messageId = msg.message_id;
        const messageText = msg.text;
        logger.info(`TGbot: message: ${messageText} chatid ${chatId}`, { messageText, chatId });

        if (msg.text !== undefined && !msg.text.startsWith("/")) {
            const currentState = getState(chatId.toString());
            logger.info(`currentState ${currentState?.state}`);
            if (currentState) {
                logger.info(`currentState ${currentState.state}`);
                if (currentState.state == STATE.INPUT_TOKEN) {
                    logger.info(`INPUT_TOKEN`);
                    buyController.showBuyPad(msg);
                    removeState(chatId);
                } else if (currentState.state == STATE.INPUT_BUY_AMOUNT) {
                    removeState(chatId);
                    logger.info(`INPUT_BUY_AMOUNT`);
                    buyController.buyXAmount(msg);
                } else if (currentState.state == STATE.INPUT_PRIVATE_KEY) {
                    logger.info(`INPUT_PRIVATE_KEY`);
                    walletController.handlePrivateKey(msg);
                } else if (currentState.state == STATE.INPUT_COPYTRADE) {
                    logger.info(`INPUT_COPYTRADE`);
                    copytradeController.handleInput(msg, currentState.data);
                } else if (currentState.state === STATE.COPYTRADE_INPUT) {
                    logger.info(`COPYTRADE_INPUT`);
                    copytradeController.handleInput(msg, currentState.data);
                } else if (currentState.state === STATE.SETTING_REFERRAL_WALLET) {
                    await handleReferralWalletMessage(msg);
                }
            } else {
                // No active state: check if auto-buy is enabled and the message is a contract address.
                autoBuyController.checkAutoBuy(msg);
            }
        }
    });

    botInstance.on("callback_query", (query: CallbackQueryData) => {
        try {
            if (!query.message) {
                logger.error("missing message object");
                return;
            }
            const chatId = query.message.chat.id;
            const data = query.data;
            logger.info(`TGbot: callback, chatId = ${chatId}, data = ${data} query =${query}`, { chatId, data, query });
            if (data?.startsWith("buyController_")) {
                buyController.handleCallBackQuery(query);
            } else if (data?.startsWith("ct_")) {
                copytradeController.handleCallBackQuery(query);
            } else if (data?.startsWith("sc_")) {
                sellController.handleCallBackQuery(query);
            } else if (data?.startsWith("walletController_")) {
                walletController.handleCallBackQuery(query);
            } else if (data?.startsWith("wC_")) {
                withdrawController.handleCallBackQuery(query);
            } else if (data?.startsWith("settingController_")) {
                settingController.handleCallBackQuery(query);
            } else if (data?.startsWith("pC_")) {
                portfolioController.handleCallBackQuery(query);
            } else if (data?.startsWith("pos_")) {
                positionController.handleCallBackQuery(query);
            } else if (data?.startsWith("autoBuyController_")) {
                autoBuyController.handleCallBackQuery(query);
            } else if (data?.startsWith("referralController_")) {
                referralController.handleCallBackQuery(query);
            } else if (data?.startsWith("helpController_")) {
                helpController.handleCallBackQuery(query);
            } else if (data?.startsWith("back_start")) {
                backToStart(query);
            } else if (data?.startsWith("close")) {
                closeMessage(query);
            } else if (data?.startsWith("dismiss")) {
                return;
            }
        } catch (error) {
            logger.error("Callback query error", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
};

export const runAutoSellSchedule = () => {
    const scheduler = "*/5 * * * * *"; // every 5 seconds
    try {
        cron.schedule(scheduler, () => {
            sellController.autoSellHandler();
        }).start();
    } catch (error) {
        logger.error(`Error running the Schedule Job for Auto Sell: ${error}`);
    }
};

export const closeMessage = (query: CallbackQueryData) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in closeMessage");
        return;
    }

    const { chatId, messageId } = getChatIdandMessageId(query);
    if (!chatId || !messageId) return;

    botInstance.deleteMessage(chatId, messageId).catch((error: Error) => {
        logger.warn(`Failed to delete message ${messageId} in chat ${chatId}: ${error.message}`);
    });
};

export const getChatIdandMessageId = (query: CallbackQueryData) => {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    return { chatId, messageId };
};

export async function switchMenu(
    chatId: TelegramBot.ChatId,
    messageId: number | undefined,
    title: string,
    json_buttons: Array<Array<{ text: string; callback_data: string }>>
) {
    if (!botInstance) {
        logger.error("Bot instance not initialized in switchMenu");
        return;
    }

    const keyboard = {
        inline_keyboard: json_buttons,
        resize_keyboard: true,
        one_time_keyboard: true,
        force_reply: true,
    };

    try {
        // Can't fetch original message content with Telegram API
        //const currentMessage = await botInstance.getChat(chatId);

        // Instead, catch the specific error and ignore it
        await botInstance.editMessageText(title, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard,
            disable_web_page_preview: true,
            parse_mode: "HTML",
        });
    } catch (error) {
        if (error instanceof Error) {
            if (error.message.includes("message is not modified")) {
                logger.info("Skipped edit: message content and markup are identical");
            } else {
                logger.error("Error editing message", { error: error.message });
            }
        }
    }
}

const onStartCommand = async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onStartCommand");
        return;
    }

    logger.info("user:", { username: msg.chat.username });
    const referralCode: string | null = match ? match[1] : null;
    logger.info("referral_info: ", { referer: referralCode, referee: msg.chat.id });
    if (referralCode) {
        const referral = await getReferralByRefereeId(referralCode);
        if (referral) {
            const newReferrers = [...referral.referrers];
            for (let i = newReferrers.length - 1; i > 0; i--) {
                newReferrers[i] = newReferrers[i - 1];
            }
            newReferrers[0] = referralCode;
            await createReferral(msg.chat.id.toString(), newReferrers);
            logger.info("update referral", { newReferrers });
        } else {
            const newReferral = await createReferral(msg.chat.id.toString(), [null, null, null, null, null]);
            logger.info("create referral", { newReferral });
        }
    } else {
        const referral = await getReferralByRefereeId(msg.chat.id.toString());
        if (!referral) {
            const newReferral = await createReferral(msg.chat.id.toString(), [null, null, null, null, null]);
            logger.info("create referral", { newReferral });
        }
    }
    const { title, buttons } = await getTitleAndButtons(msg.chat.id);
    botInstance.sendMessage(msg.chat.id, title, {
        reply_markup: {
            inline_keyboard: buttons,
        },
        parse_mode: "HTML",
    });
};

const onWalletCommand = (msg: TelegramBot.Message) => {
    // Implement wallet command handling if needed.
};

const onHelpCommand = (msg: TelegramBot.Message) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onHelpCommand");
        return;
    }

    // Implement help command handling if needed.
    const chatId = msg.chat.id;
    const message = helpText;

    botInstance.sendMessage(chatId!, message, {
        reply_markup: {
            inline_keyboard: [[{ text: "Close", callback_data: "close" }]],
        },
        parse_mode: "HTML",
    });
};

const backToStart = async (query: CallbackQueryData) => {
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
        const balance = await getSolBalance(wallet.privateKey);
        const publicKey = getPublicKey(wallet.privateKey);
        walletInfo = `Address: <code>${publicKey}</code> \nBalance: ${balance} SOL`;
    }

    return {
        title: `<b>Welcome to MoonBot</b> \n\nThe first copy sniping telegram bot with one directive: buy low and sell high. \n\n${walletInfo}`,
        buttons: [
            [
                { text: "Buy", callback_data: "buyController_start" },
                { text: "Sell", callback_data: "sc_start" },
            ],
            [
                { text: "Copy Trade Groups/Channels", callback_data: "ct_start" },
                { text: "Autobuy", callback_data: "autoBuyController_start" },
            ],
            [
                { text: "Portfolio", callback_data: "pC_start" },
                { text: "Position", callback_data: "pos_start" },
            ],
            [
                { text: "Referrals (Coming soon) 🔜", callback_data: "referralController_start" },
                { text: "Settings (Coming soon) 🔜", callback_data: "settingController_start" },
            ],
            [
                { text: "Wallet", callback_data: "walletController_start" },
                { text: "Withdraw", callback_data: "wC_start" },
            ],
            [
                { text: "Help", callback_data: "helpController_start" },
                { text: "Refresh", callback_data: "Refresh" },
            ],
        ],
    };
};
