import TelegramBot from "node-telegram-bot-api";
import { botInstance, switchMenu, getChatIdandMessageId, setState, STATE, setDeleteMessageId, getDeleteMessageId, trade, setTradeState } from "../bot";
import { TELEGRAM_BOT_USERNAME, SOLANA_CONNECTION } from "..";
import * as walletdb from '../models/walletModel';
import * as tradedb from '../models/tradeModel';
import { getPrice } from "./autoBuyController";
const { PublicKey } = require('@solana/web3.js'); // Import PublicKey

import { transcode } from "buffer";
import { logger } from "../logger";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
	try {
		const data = query.data;
		if (data == "referralController_start") {
			onReferralSystemStart(query);
		} else if (data == "buyController_0.5buy") {
		} else if (data == "buyController_1.0buy") {
		} else if (data == "buyController_Xbuy") {
		}
	} catch (error) {
	}

}


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
		const reply_markup = {
			inline_keyboard: [
				[{ text: 'Close', callback_data: "close" }]
			],
		};

		const caption = "<b>Referral system</b>\n\n" +
			"1. <b>Get 10% of the profit from your referrals</b>\n\n" +
			"2. <b>Get 5% of the profit from your referrals' referrals</b>\n\n" +
			"3. <b>Get 2% of the profit from your referrals' referrals' referrals</b>\n\n" +
			"4. <b>Get 1% of the profit from your referrals' referrals' referrals' referrals</b>\n\n" +
			"5. <b>Get 0.5% of the profit from your referrals' referrals' referrals' referrals' referrals</b>\n\n" +
			`Your referral link is here: \n<code>${referral_link}</code>\n\n`;

		await botInstance.sendMessage(chatId, caption, {
			parse_mode: "HTML",
			disable_web_page_preview: false,
			reply_markup,
		});
	} catch (error) {
		logger.error("onReferralSystemStart Error", { error });
	}
}