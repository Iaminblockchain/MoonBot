import TelegramBot from "node-telegram-bot-api";
import * as walletdb from '../models/walletModel';
import * as copytradedb from '../models/copyTradeModel';
import { botInstance } from "../bot";
import axios from "axios";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  const { data: callbackData, message: callbackMessage } = query;
  if (!callbackData || !callbackMessage) return;
  try {
    if (callbackData == "ct_start") {
      showPositionPad(callbackMessage.chat.id);
    } else if (callbackData == "ct_add_signal") {
      addcopytradesignal(callbackMessage.chat.id, callbackMessage.message_id);
    } else if (callbackData == "ct_remove_signal") {
      removecopytradesignal(callbackMessage.chat.id, callbackMessage.message_id);
    }
  } catch (error) {

  }
}

const showPositionPad = async (chatId: number, replaceId?: number) => {
  const signals = await copytradedb.getTradeByChatId(chatId);
  const wallet = await walletdb.getWalletByChatId(chatId);
  if (!wallet) return;
  let text = '';
  signals.forEach((value, index) => {
    text += `${index + 1} : @${value}\n`
  })
  const caption = `<b>Copy Trade:</b>\n\n` + text;
  const walletKeyboardList = [
    [{ text: "Add Signal", command: "ct_add_signal" }],
    [{ text: "Remove Signal", command: "ct_remove_signal" }],
    [{ text: "Close", command: "close" }],
  ];

  const reply_markup = {
    inline_keyboard:
      walletKeyboardList.map((rowItem) =>
        rowItem.map((item) => {
          return {
            text: item.text,
            callback_data: item.command,
          };
        })
      ),
  };

  if (replaceId) {
    botInstance.editMessageText(caption, {
      message_id: replaceId,
      chat_id: chatId,
      parse_mode: "HTML",
      disable_web_page_preview: false,
      reply_markup,
    });
  } else {
    await botInstance.sendMessage(chatId, caption, {
      parse_mode: "HTML",
      disable_web_page_preview: false,
      reply_markup,
    });
  }
}

const addcopytradesignal = async (chatId: number, replaceId: number) => {
  const caption = `<b>Please type signal channel name</b>`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg) => {
    const signal = n_msg.text ?? '';
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    const parts = signal.trim().split('/');
    const result = parts[parts.length - 1];
    await copytradedb.addTrade(chatId, result)
    showPositionPad(chatId, replaceId)
  });
}

const removecopytradesignal = async (chatId: number, replaceId: number) => {
  const caption = `<b>Please type signal index to remove</b>`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg) => {
    const signalIndex = n_msg.text ?? '';
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    const index = parseInt(signalIndex);
    await copytradedb.removeTrade(chatId, index)
    showPositionPad(chatId, replaceId);
  });
}