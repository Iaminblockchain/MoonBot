import TelegramBot from "node-telegram-bot-api";
import * as walletdb from "../models/walletModel";
import * as copytradedb from "../models/copyTradeModel";
import { botInstance } from "../bot";
import axios from "axios";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  const { data: callbackData, message: callbackMessage } = query;
  if (!callbackData || !callbackMessage) return;
  try {
    if (callbackData == "ct_start") {
      showPositionPad(callbackMessage.chat.id);
    } else if (callbackData == "ct_add_signal") {
      // botInstance.answerCallbackQuery({
      //   callback_query_id: query.id,
      //   text: "hello?",
      //   show_alert: false,
      // });
// replaceId
      editcopytradesignal(callbackMessage.chat.id);
    } else if (callbackData == "ct_remove_signal") {
      removecopytradesignal(
        callbackMessage.chat.id,
        callbackMessage.message_id
      );
    }
  } catch (error) {}
};

const showPositionPad = async (chatId: number, replaceId?: number) => {
  const signals = await copytradedb.getTradeByChatId(chatId);
  const wallet = await walletdb.getWalletByChatId(chatId);
  if (!wallet) return;
  const caption = `<b>Copy Trade</b>\n\n
Copy Trade allows you to copy the buys and sells of any target wallet. 
🟢 Indicates a copy trade setup is active.
🟠 Indicates a copy trade setup is paused.`;
  const signalKeyboard = signals.map((value, index) => {
    return [
      {
        text: value.tag ?? "Signal " + index,
        command: "ct_edit_" + value.id,
      },
    ];
  });
  const keyboardList = signalKeyboard.concat([
    [{ text: "Add Signal", command: "ct_add_signal" }],
    [{ text: "Remove Signal", command: "ct_remove_signal" }],
    [{ text: "Close", command: "close" }],
  ]);

  const reply_markup = {
    inline_keyboard: keyboardList.map((rowItem) =>
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
};

const editcopytradesignal = async (
  chatId: number,
  dbId?: string,
  replaceId?: number
) => {
  const caption = `<b>To setup a new Copy Trade</b>
- Assign a unique name or “tag” to your target wallet, to make it easier to identify.
- Set the target signal channel to get signal contract address(https://t.me/abc or @abc).
- Set a specific SOL amount to always use for signals from signal channel.
- Set the number of times to replicate the purchase.
- Set Toke Profit/Value for sell from signal channel.

To manage your Copy Trade:
- Click the “Active” button to pause the Copy Trade.
- Delete a Copy Trade by clicking the “Delete” button`;
  let trade;
  if (dbId) {
    trade = await copytradedb.findTrade({ id: dbId });
  } else {
    trade = await copytradedb.addTrade(chatId);
  }
  const reply_markup = {
    inline_keyboard: editCopyTradeKeyboard(trade!.toObject()).map((rowItem) =>
      rowItem.map((item) => {
        return {
          text: item.text,
          callback_data: item.command,
        };
      })
    ),
  };

  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(
    new_msg.chat.id,
    new_msg.message_id,
    async (n_msg) => {
      const signal = n_msg.text ?? "";
      botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
      botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

      const parts = signal.trim().split("/");
      const result = parts[parts.length - 1];
      // await copytradedb.addTrade(chatId, result);
      showPositionPad(chatId, replaceId);
    }
  );
};

const removecopytradesignal = async (chatId: number, replaceId: number) => {
  const caption = `<b>Please type signal index to remove</b>`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(
    new_msg.chat.id,
    new_msg.message_id,
    async (n_msg) => {
      const signalIndex = n_msg.text ?? "";
      botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
      botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

      const index = parseInt(signalIndex);
      // await copytradedb.removeTrade(chatId, index)
      showPositionPad(chatId, replaceId);
    }
  );
};

const editCopyTradeKeyboard = (params: copytradedb.ITrade) => {
  return [
    [{ text: `Tag : ${params.tag}`, command: `ct_tag_${String(params._id)}` }],
    [{ text: `Signal : @${params.signal}`, command: `ct__sig_${String(params._id)}` }],
    [
      {
        text: `Buy Amount : ${params.amount} SOL`,
        command: `ct__buya_${String(params._id)}`,
      },
    ],
    [
      {
        text: `Slippage : ${params.maxSlippage}%`,
        command: `ct__sli_${String(params._id)}`,
      },
      {
        text: `Replicate Buy : ${params.maxSlippage} times`,
        command: `ct__rep_${String(params._id)}`,
      },
    ],
    [
      { text: `Stop Loss : ${params.sl}%`, command: `ct__stl_${String(params._id)}` },
      {
        text: `Take Profit : ${params.tp}%`,
        command: `ct__tpr_${String(params._id)}`,
      },
    ],
    [
      {
        text: `${params.active ? "🟢 Active" : "🔴 Pause"}`,
        command: `ct__act_${String(params._id)}`,
      },
      {
        text: `Delete`,
        command: `ct__del_${String(params._id)}`,
      },
    ],
  ];
};
