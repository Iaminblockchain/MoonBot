import TelegramBot from 'node-telegram-bot-api';
import { botInstance } from '../bot';

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  console.log('Received help callback query:', query);
  // Placeholder: answer the callback query
  botInstance.answerCallbackQuery(query.id, { text: 'Help info not yet implemented' });
};