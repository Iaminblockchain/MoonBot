import { botInstance } from "./bot";

export const notifySuccess = async (chatId: string, message: string) => {
    const sent = await botInstance.sendMessage(chatId, `✅ ${message}`);
    setTimeout(() => {
        botInstance.deleteMessage(chatId, sent.message_id).catch(() => { });
    }, 2000);
}

export const notifyError = async (chatId: string, message: string) => {
    const sent = await botInstance.sendMessage(chatId, `❌ ${message}`);
    setTimeout(() => {
        botInstance.deleteMessage(chatId, sent.message_id).catch(() => { });
    }, 2000);
};