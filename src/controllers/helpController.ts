import TelegramBot from 'node-telegram-bot-api';
import { botInstance } from '../bot';
import { helpText } from '../util/constants';

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
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