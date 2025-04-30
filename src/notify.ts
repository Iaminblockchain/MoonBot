import { botInstance } from "./bot";
import { logger } from "./logger";

export const notifySuccess = async (chatId: string, message: string) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in notifySuccess");
        return;
    }

    const sent = await botInstance.sendMessage(chatId, `✅ ${message}`);
    setTimeout(() => {
        if (!botInstance) {
            logger.error("Bot instance not initialized in notifySuccess timeout");
            return;
        }
        botInstance.deleteMessage(chatId, sent.message_id).catch(() => {});
    }, 2000);
};

export const notifyError = async (chatId: string, message: string) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in notifyError");
        return;
    }

    const sent = await botInstance.sendMessage(chatId, `❌ ${message}`);
    setTimeout(() => {
        if (!botInstance) {
            logger.error("Bot instance not initialized in notifyError timeout");
            return;
        }
        botInstance.deleteMessage(chatId, sent.message_id).catch(() => {});
    }, 2000);
};
