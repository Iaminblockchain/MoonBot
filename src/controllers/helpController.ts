import TelegramBot from 'node-telegram-bot-api';
import { botInstance } from '../bot';
import { helpText } from '../util/constants';
import { logger } from '../logger';

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  if (!botInstance) {
    logger.error("Bot instance not initialized in helpController.handleCallBackQuery");
    return;
  }

  const chatId = query.message?.chat.id;
  const msg = helpText;

  botInstance.sendMessage(chatId!, msg, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Close', callback_data: "close" }
        ]
      ]
    }, parse_mode: 'HTML'
  });
};