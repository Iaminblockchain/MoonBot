import TelegramBot from "node-telegram-bot-api";
import * as walletdb from "../models/walletModel";
import * as copytradedb from "../models/copyTradeModel";
import { botInstance } from "../bot";
import axios from "axios";
import { setAutotrade } from "./autoBuyController";
import mongoose from "mongoose";

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
      editcopytradesignal(callbackMessage.chat.id, callbackMessage.message_id);
    } else if (callbackData.startsWith("ct_edit_")) {
      const data = callbackData.split("_");
      editcopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_del_")) {
      const data = callbackData.split("_");
      removecopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_tag_")) {
      const data = callbackData.split("_");
      editTagcopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_sig_")) {
      const data = callbackData.split("_");
      editSignalcopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_buya_")) {
      const data = callbackData.split("_");
      editBuyAmountcopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_sli_")) {
      const data = callbackData.split("_");
      editSlippagecopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_rep_")) {
      const data = callbackData.split("_");
      editreplicatecopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_stl_")) {
      const data = callbackData.split("_");
      editStopLosscopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_tpr_")) {
      const data = callbackData.split("_");
      editTakeProfitcopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_act_")) {
      const data = callbackData.split("_");
      editActivitycopytradesignal(callbackMessage.chat.id, callbackMessage.message_id, data[2]);
    } else if (callbackData == "ct_back") {
      showPositionPad(callbackMessage.chat.id, callbackMessage.message_id);
    }
  } catch (error) { }
};

const showPositionPad = async (chatId: number, replaceId?: number) => {
  const signals = await copytradedb.getTradeByChatId(chatId);
  const wallet = await walletdb.getWalletByChatId(chatId);
  if (!wallet) return;
  const caption = `<b>Copy Trade</b>\n\n
Copy Trade allows you to copy the buys and sells of any target wallet. 
🟢 Indicates a copy trade setup is active.
🔴 Indicates a copy trade setup is paused.`;
  const signalKeyboard = signals.map((value, index) => {
    return [
      {
        text: ` ${value.active ? "🟢" : "🔴" } Signal ${index + 1} : ${value.tag}`,
        command: "ct_edit_" + value.id,
      },
    ];
  });
  const keyboardList = signalKeyboard.concat([
    [{ text: "Add Signal", command: "ct_add_signal" }],
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
  replaceId: number,
  dbId?: string,
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
    trade = await copytradedb.findTrade({ _id: new mongoose.Types.ObjectId(dbId) });
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

  botInstance.editMessageText(caption, {
    message_id: replaceId,
    chat_id: chatId,
    parse_mode: "HTML",
    disable_web_page_preview: false,
    reply_markup,
  });
};

const removecopytradesignal = async (chatId: number, replaceId: number, dbId: string) => {
  const signals = await copytradedb.removeTrade(new mongoose.Types.ObjectId(dbId));
  showPositionPad(chatId, replaceId);
};

const editTagcopytradesignal = async (chatId: number, replaceId: number, dbId: string) => {
  const caption = `<b>Please type Your signal Tag name</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {
      await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), tag: n_msg.text })
      editcopytradesignal(chatId, replaceId, dbId);
    }
  });

}

const editSignalcopytradesignal = async (chatId: number, replaceId: number, dbId: string) => {
  const caption = `<b>Please type your signal like "@solsignal" or "https://t.me/solsignal"</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {
      await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), signal: copytradedb.extractAddress(n_msg.text) })
      editcopytradesignal(chatId, replaceId, dbId);
    }
  });
}

const editBuyAmountcopytradesignal = async (chatId: number, replaceId: number, dbId: string) => {
  const caption = `<b>Please type sol amount to buy token</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {
      await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), amount: parseFloat(n_msg.text) })
      editcopytradesignal(chatId, replaceId, dbId);
    }
  });
}

const editSlippagecopytradesignal = async (chatId: number, replaceId: number, dbId: string) => {
  const caption = `<b>Please type your max slippage for swap</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {
      await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), maxSlippage: parseFloat(n_msg.text) })
      editcopytradesignal(chatId, replaceId, dbId);
    }
  });
}

const editreplicatecopytradesignal = async (chatId: number, replaceId: number, dbId: string) => {
  const caption = `<b>Please type number of repetitive bought</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {
      await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), repetitiveBuy: parseInt(n_msg.text) })
      editcopytradesignal(chatId, replaceId, dbId);
    }
  });
}

const editStopLosscopytradesignal = async (chatId: number, replaceId: number, dbId: string) => {
  const caption = `<b>Please type stop loss percentage</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {
      await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), sl: parseFloat(copytradedb.extractAddress(n_msg.text)) })
      editcopytradesignal(chatId, replaceId, dbId);
    }
  });
}

const editTakeProfitcopytradesignal = async (chatId: number, replaceId: number, dbId: string) => {
  const caption = `<b>Please type take profit percentage</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {
      await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), tp: parseFloat(copytradedb.extractAddress(n_msg.text)) })
      editcopytradesignal(chatId, replaceId, dbId);
    }
  });
}

const editActivitycopytradesignal = async (chatId: number, replaceId: number, dbId: string) => {

  await copytradedb.findAndUpdateOne({ _id: new mongoose.Types.ObjectId(dbId) }, [
    { $set: { active: { $not: "$active" } } },
  ])
  editcopytradesignal(chatId, replaceId, dbId);

}

const editCopyTradeKeyboard = (params: copytradedb.ITrade) => {
  return [
    [{ text: `Tag : ${params.tag == '' ? '-' : params.tag}`, command: `ct_tag_${String(params._id)}` }],
    [{ text: `Signal : ${params.signal == '' ? '-' : `@${params.signal}`}`, command: `ct_sig_${String(params._id)}` }],
    [
      {
        text: `Buy Amount : ${params.amount} SOL`,
        command: `ct_buya_${String(params._id)}`,
      },
    ],
    [
      {
        text: `Slippage : ${params.maxSlippage}%`,
        command: `ct_sli_${String(params._id)}`,
      },
      {
        text: `Replicate Buy : ${params.repetitiveBuy} times`,
        command: `ct_rep_${String(params._id)}`,
      },
    ],
    [
      { text: `Stop Loss : ${params.sl}%`, command: `ct_stl_${String(params._id)}` },
      {
        text: `Take Profit : ${params.tp}%`,
        command: `ct_tpr_${String(params._id)}`,
      },
    ],
    [
      {
        text: `${params.active ? "🟢 Active" : "🔴 Pause"}`,
        command: `ct_act_${String(params._id)}`,
      },
      {
        text: `Delete`,
        command: `ct_del_${String(params._id)}`,
      },
    ], [
      {
        text: `👈 Back`,
        command: `ct_back`,
      },
    ]
  ];
};

export const onSignal = async (channel: string, address: string) => {
  const chatIds = await copytradedb.getChatIdByChannel(channel);
  chatIds.forEach((id) => {
    console.log("run auto signal:", id, address);
    setAutotrade(id, address, channel);
  });
};