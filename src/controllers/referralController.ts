import TelegramBot from "node-telegram-bot-api";
import {
    botInstance,
    switchMenu,
    getChatIdandMessageId,
    setState,
    getState,
    STATE,
    setDeleteMessageId,
    getDeleteMessageId,
    trade,
    setTradeState,
} from "../bot";
import { TELEGRAM_BOT_USERNAME, SOLANA_CONNECTION } from "..";
import * as walletdb from "../models/walletModel";
import * as tradedb from "../models/tradeModel";
const { PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js"); // Import PublicKey

import { transcode } from "buffer";
import { logger } from "../logger";
import { getRewards } from "../models/referralModel";
import { getPublicKey } from "../solana/util";
import { sendMessageToUser } from "../botUtils";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    try {
        const data = query.data;
        if (data == "referralController_start") {
            onReferralSystemStart(query);
        } else if (data == "referralController_set_wallet") {
            onSetReferralWallet(query);
        }
    } catch (error) {}
};

const onReferralSystemStart = async (query: TelegramBot.CallbackQuery) => {
    try {
        if (!botInstance) {
            logger.error("Bot instance not initialized in onReferralSystemStart");
            return;
        }

        const chatId = query.message?.chat.id;
        if (!chatId) {
            logger.error("Chat ID not found in onReferralSystemStart");
            return;
        }

        const referral_link = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${chatId}`;
        const rewards = await getRewards(chatId.toString());
        const rewardsInSol = rewards / LAMPORTS_PER_SOL;

        // Get main wallet and referral wallet
        const mainWallet = await walletdb.getWalletByChatId(chatId);
        const referralWalletPrivateKey = await walletdb.getReferralWallet(chatId);

        // Get public keys
        const mainWalletPublicKey = mainWallet ? getPublicKey(mainWallet.privateKey) : null;
        const referralWalletPublicKey = referralWalletPrivateKey ? getPublicKey(referralWalletPrivateKey) : null;

        const reply_markup = {
            inline_keyboard: [
                [{ text: "Set Referral Wallet", callback_data: "referralController_set_wallet" }],
                [{ text: "Close", callback_data: "close" }],
            ],
        };

        const caption =
            "<b>Referral system</b>\n\n" +
            "1. Get <b>25%</b> of the profit from your <b>referrals</b>\n" +
            "2. Get <b>3.5%</b> of the profit from your <b>referrals' referrals</b>\n" +
            "3. Get <b>2.5%</b> of the profit from your <b>referrals' referrals' referrals</b>\n" +
            "4. Get <b>2%</b> of the profit from your <b>referrals' referrals' referrals' referrals</b>\n" +
            "5. Get <b>1%</b> of the profit from your <b>referrals' referrals' referrals' referrals' referrals</b>\n\n" +
            `Your current rewards: <b>${Number(rewardsInSol.toFixed(9)).toString()} SOL</b>\n\n` +
            `Referral wallet: <code>${referralWalletPublicKey || mainWalletPublicKey || "Not set"}</code>\n\n` +
            `Your referral link is here: \n<code><b>${referral_link}</b></code>\n\n`;

        await sendMessageToUser(chatId, caption, {
            parse_mode: "HTML",
            disable_web_page_preview: false,
            reply_markup,
        });
    } catch (error) {
        logger.error("onReferralSystemStart Error", { error });
    }
};

const onSetReferralWallet = async (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onSetReferralWallet");
        return;
    }

    try {
        const { chatId, messageId } = getChatIdandMessageId(query);
        if (!chatId) {
            logger.error("Chat ID not found in onSetReferralWallet");
            return;
        }

        const promptMessage = await sendMessageToUser(chatId, "Input private key for your referral wallet:");
        setState(chatId, STATE.SETTING_REFERRAL_WALLET, {
            messageId,
            promptMessageId: promptMessage.message_id,
        });
    } catch (error) {
        logger.error("onSetReferralWallet error:", error);
    }
};

export const handleReferralWalletMessage = async (msg: TelegramBot.Message) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in handleReferralWalletMessage");
        return;
    }

    try {
        const chatId = msg.chat.id;
        const messageId = msg.message_id;
        const privateKey = msg.text;
        const stateData = getState(chatId);
        const promptMessageId = stateData?.data?.promptMessageId;

        if (!privateKey) {
            await sendMessageToUser(chatId, "Please provide a valid private key.");
            return;
        }

        try {
            // Validate the private key by getting the public key
            const publicKey = getPublicKey(privateKey);

            const success = await walletdb.updateReferralWallet(chatId, privateKey);
            if (success) {
                await sendMessageToUser(chatId, `Referral wallet set successfully to: <code>${publicKey}</code>`, {
                    parse_mode: "HTML",
                });
            } else {
                await sendMessageToUser(chatId, "Failed to set referral wallet. Please try again.");
            }
        } catch (error) {
            await sendMessageToUser(chatId, "Invalid private key. Please provide a valid Solana private key.");
        }

        // Delete the input message and the prompt message
        await botInstance.deleteMessage(chatId, messageId);
        if (promptMessageId) {
            await botInstance.deleteMessage(chatId, promptMessageId);
        }

        // Return to main menu
        setState(chatId, STATE.MAIN_MENU);
    } catch (error) {
        logger.error("handleReferralWalletMessage error:", error);
    }
};
