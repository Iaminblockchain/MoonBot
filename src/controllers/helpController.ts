import TelegramBot from "node-telegram-bot-api";
import { sendMessageToUser } from "../botUtils";
import { helpText } from "../util/constants";
import { logger } from "../logger";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    if (!sendMessageToUser) {
        logger.error("Bot instance not initialized in helpController.handleCallBackQuery");
        return;
    }

    const chatId = query.message?.chat.id;
    const msg = helpText;

    sendMessageToUser(chatId!, msg, {
        reply_markup: {
            inline_keyboard: [[{ text: "Close", callback_data: "close" }]],
        },
        parse_mode: "HTML",
    });
};
