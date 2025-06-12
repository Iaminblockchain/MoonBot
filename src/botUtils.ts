import TelegramBot from "node-telegram-bot-api";
import { botInstance } from "./bot";
import { logger } from "./logger";

/**
 * Wrapper for botInstance.sendMessage that automatically logs the message
 * @param chatId - The chat ID to send the message to (can be string or number)
 * @param text - The message text
 * @param options - Optional Telegram message options
 * @returns Promise<TelegramBot.Message>
 */
export const sendMessageToUser = async (
    chatId: string | number,
    text: string,
    options?: TelegramBot.SendMessageOptions
): Promise<TelegramBot.Message> => {
    if (!botInstance) {
        throw new Error("Bot instance not initialized");
    }

    // Convert chatId to string if it's a number
    const chatIdStr = typeof chatId === "number" ? chatId.toString() : chatId;

    // Log the message before sending
    logger.info("Sending Telegram message", {
        chatId: chatIdStr,
        text,
        options: options ? JSON.stringify(options) : undefined,
    });

    try {
        const message = await botInstance.sendMessage(chatIdStr, text, options);
        return message;
    } catch (error) {
        // Log any errors that occur during sending
        logger.error("Failed to send Telegram message", {
            chatId: chatIdStr,
            error: error instanceof Error ? error.message : String(error),
            text,
        });
        throw error;
    }
};
