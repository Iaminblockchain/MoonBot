import TelegramBot from "node-telegram-bot-api";
import * as walletdb from "../models/walletModel";
import * as copytradedb from "../models/copyTradeModel";
import { botInstance, setState, STATE, removeState } from "../bot";
import { TelegramClient } from "telegram";
import { setAutotradeSignal } from "./autoBuyController";
import mongoose from "mongoose";
import { logger } from "../util";
import { Trade } from '../models/copyTradeModel';
import { Chat } from "../models/chatModel";
import { getQueue } from '../scraper/queue';
import { notifySuccess, notifyError } from "../notify";

let tgClient: TelegramClient | null = null;

export const setClient = (client: TelegramClient) => {
  tgClient = client;
};

type FieldKey =
  | 'tag'
  | 'signal'
  | 'amount'
  | 'slippage'
  | 'rep'
  | 'sl'
  | 'tp';

interface InputCtx {
  field: FieldKey;
  tradeId: string;
  replaceId: number;
}

export const handleInput = async (
  msg: TelegramBot.Message,
  ctx: InputCtx
) => {
  const chatId = msg.chat.id.toString();
  const text = (msg.text || '').trim();

  if (!text) return;

  try {
    switch (ctx.field) {
      case 'tag':
        await copytradedb.updateTrade({ id: ctx.tradeId, tag: text });
        break;
      case 'signal':
        await copytradedb.updateTrade({ id: ctx.tradeId, signal: text });
        break;
      case 'amount':
        await copytradedb.updateTrade({ id: ctx.tradeId, amount: +text });
        break;
      case 'slippage':
        await copytradedb.updateTrade({ id: ctx.tradeId, maxSlippage: +text });
        break;
      case 'rep':
        await copytradedb.updateTrade({ id: ctx.tradeId, repetitiveBuy: +text });
        break;
      case 'sl':
        await copytradedb.updateTrade({ id: ctx.tradeId, sl: +text });
        break;
      case 'tp':
        await copytradedb.updateTrade({ id: ctx.tradeId, tp: +text });
        break;
    }

    // refresh the inline‑keyboard
    await editcopytradesignal(chatId, ctx.replaceId, ctx.tradeId);
    await notifySuccess(chatId, 'Updated');
  } catch (err) {
    logger.error(err);
    await notifyError(chatId, 'Update failed');
  } finally {
    removeState(chatId);
  }
};

export const safeEditMessageText = async (
  chatId: TelegramBot.ChatId,
  messageId: number,
  text: string,
  opts: TelegramBot.EditMessageTextOptions
) => {
  try {
    await botInstance.editMessageText(text, {
      ...opts,
      chat_id: chatId,
      message_id: messageId
    });
  } catch (err: any) {
    const desc = err?.response?.body?.description || '';
    if (desc.includes('message to edit not found')) {
      logger.warn(`editMessageText failed (not found) → sendMessage`, { chatId, messageId });
      await botInstance.sendMessage(chatId, text, opts as any);
    } else {
      logger.error('editMessageText error', { err });
    }
  }
};


export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  logger.info("copytrade: handleCallBackQuery ", { query: query });
  const { data: callbackData, message: callbackMessage } = query;
  logger.info("copytrade: callbackData ", { callbackData: callbackData });
  if (!callbackData || !callbackMessage) return;
  try {
    let chatid_string = String(callbackMessage.chat.id);
    if (callbackData == "ct_start") {
      showPositionPad(chatid_string);
    } else if (callbackData == "ct_add_signal") {
      // botInstance.answerCallbackQuery({
      //   callback_query_id: query.id,
      //   text: "hello?",
      //   show_alert: false,
      // });
      walletdb.getWalletByChatId(callbackMessage.chat.id)
        .then(wallet => {
          if (!wallet) {
            return botInstance.sendMessage(
              callbackMessage.chat.id,
              "You need to set up your wallet first"
            );
          }
          editcopytradesignal(chatid_string, callbackMessage.message_id);
        })
        .catch(err => {
          logger.error("wallet lookup failed", err);
          botInstance.sendMessage(chatid_string, "❌ Something went wrong.");
        });
    } else if (callbackData.startsWith("ct_edit_")) {
      const data = callbackData.split("_");
      editcopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_del_")) {
      const data = callbackData.split("_");
      removecopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_tag_")) {
      const data = callbackData.split("_");
      editTagcopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_sig_")) {
      const data = callbackData.split("_");
      editSignalcopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_buya_")) {
      const data = callbackData.split("_");
      editBuyAmountcopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_sli_")) {
      const data = callbackData.split("_");
      editSlippagecopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_rep_")) {
      const data = callbackData.split("_");
      editreplicatecopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_stl_")) {
      const data = callbackData.split("_");
      editStopLosscopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_tpr_")) {
      const data = callbackData.split("_");
      editTakeProfitcopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData.startsWith("ct_act_")) {
      const data = callbackData.split("_");
      editActivitycopytradesignal(chatid_string, callbackMessage.message_id, data[2]);
    } else if (callbackData == "ct_back") {
      showPositionPad(chatid_string, callbackMessage.message_id);
    }
  } catch (error) { }
};

const showPositionPad = async (chatId: string, replaceId?: number) => {
  const signals = await copytradedb.getTradeByChatId(chatId);
  const wallet = await walletdb.getWalletByChatId(chatId);
  if (!wallet) return;
  const caption = `<b>Copy Trade groups</b>\n\n
This function allows you to monitor any public group or channel on telegram and to buy any token as soon as the contract gets posted in the target group/channel.
You can also customize the buy amount, take profit, stop loss and more for every channel you follow.
🟢 Indicates a copy trade setup is active.
🔴 Indicates a copy trade setup is paused.`;
  const signalKeyboard = signals.map((value: copytradedb.ITrade, index: number) => {
    return [
      {
        text: ` ${value.active ? "🟢" : "🔴"} ${value.signal} : ${value.tag}`,
        command: "ct_edit_" + value.id,
      },
    ];
  });
  const keyboardList = signalKeyboard.concat([
    [{ text: "Add Signal", command: "ct_add_signal" }],
    [{ text: "Close", command: "close" }],
  ]);

  const reply_markup = {
    inline_keyboard: keyboardList.map((rowItem: { text: string; command: string }[]) =>
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
  chatId: string,
  replaceId: number,
  dbId?: string,
) => {
  const caption = `<b>HOW TO FOLLOW A GROUP/ CHANNEL</b>
- Assign a unique name or “tag” to your target group/channel, to make it easier to identify.
- Set the target signal channel (https://t.me/abc or @abc) to get signals on the coins they launch.
- Set a specific Buy amount in Sol (for this set up, the bot will always buy specified amount).
- Slippage: Difference between the expected price of a trade and the price at which the trade is executed. (Normally around 5-20% depending on how much volatile the coin is)
- Replicate Buy: Set the number of times to replicate the purchase (How many time the bot should perform the buy if a group or channel calls the coin multiple times, the fastest option is to leave it at one)
- Stop loss: If the coin dumps you can minimize the losses by setting a stop loss. Example: if you set 20, the bot will sell once the coin loses 20% of the value. 
- Take profit: Similar to the stop loss, if the coin you bought gains a specific percentage in value the bot can sell your entire position for you. 

To manage your Copy Trade:
- Click the “Active” button to pause the Copy Trade.
- Delete a Copy Trade by clicking the “Delete” button`;
  logger.info("editing copytradesignal");
  let trade;
  if (dbId) {
    logger.info("got db id");
    trade = await copytradedb.findTrade({ _id: new mongoose.Types.ObjectId(dbId) });
    logger.info(trade);
  } else {
    logger.info("no db id");

    //find chat with 
    trade = await copytradedb.addTrade(chatId);
  }
  if (!trade) {
    logger.error("No Copy Trade signal Error", { dbId: dbId, chatId: chatId })
    return;
  }
  const reply_markup = {
    inline_keyboard: editCopyTradeKeyboard(trade.toObject()).map((rowItem) =>
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

const removecopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {
  const signals = await copytradedb.removeTrade(new mongoose.Types.ObjectId(dbId));
  showPositionPad(chatId, replaceId);
};

const editTagcopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {
  const caption = `<b>Please type Your signal Tag name</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  setState(chatId, STATE.INPUT_COPYTRADE);

  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {
      //TODO  recheck      
      await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), tag: n_msg.text })
      editcopytradesignal(chatId, replaceId, dbId);
      await notifySuccess(chatId, "Tag updated");
    }
  });

}

const editSignalcopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {
  const caption = `<b>Please type your signal like "@solsignal" or "https://t.me/solsignal"</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  setState(chatId, STATE.INPUT_COPYTRADE);
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    logger.info("copytrade: onReplyToMessage")
    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {

      let signalChat = n_msg.text;
      setState(chatId, STATE.INPUT_COPYTRADE);
      logger.info(`copytrade: signalChat ${signalChat}`, { target_group: signalChat });
      try {
        const chatDoc = await Chat.findOne({ username: signalChat });
        const chatCount = await Chat.countDocuments();
        if (chatDoc == null) {
          if (!tgClient) {
            logger.error("Telegram client not available");
            return;
          }
          try {
            logger.info(`chat not found. signalChat ${signalChat} ${chatCount}`);
            logger.info("join channel");
            await getQueue().now('join-channel', { username: signalChat });
            await notifySuccess(chatId, `Joined ${signalChat} successfully.`);
          } catch (error) {
            logger.error(`error ${error}`);
            await notifyError(chatId, "can not join chat");
          }

        } else {
          const signalChatId = chatDoc.chat_id;
          logger.info("editcopytradesignal. chatid " + chatId + " signalChatId " + signalChatId);
          await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), signal: signalChat, signalChatId: signalChatId })
          editcopytradesignal(chatId, replaceId, dbId);
          await notifySuccess(chatId, "Group updated");
          removeState(chatId);
        }
      } catch (error) {
        logger.error(error);
      }

    }
  });
}

type Spec<T> = {
  label: string;
  dbKey: keyof copytradedb.ITrade;
  parse: (txt: string) => T;
};

const makeEditor =
  <T>(spec: Spec<T>) =>
    async (chatId: string, replaceId: number, dbId: string) => {
      const ask = await botInstance.sendMessage(
        chatId,
        `<b>Please type ${spec.label}</b>\n\n`,
        { parse_mode: "HTML", reply_markup: { force_reply: true } }
      );

      botInstance.onReplyToMessage(
        ask.chat.id,
        ask.message_id,
        async (reply: TelegramBot.Message) => {
          botInstance.deleteMessage(ask.chat.id, ask.message_id);
          botInstance.deleteMessage(reply.chat.id, reply.message_id);
          if (!reply.text) return;

          await copytradedb.updateTrade({
            id: new mongoose.Types.ObjectId(dbId),
            [spec.dbKey]: spec.parse(reply.text)
          });
          editcopytradesignal(chatId, replaceId, dbId);
        }
      );
    };

export const editBuyAmountcopytradesignal = makeEditor({ label: "buy amount (SOL)", dbKey: "amount", parse: Number });
export const editSlippagecopytradesignal = makeEditor({ label: "max slippage (%)", dbKey: "maxSlippage", parse: Number });
export const editreplicatecopytradesignal = makeEditor({ label: "replicate count", dbKey: "repetitiveBuy", parse: n => parseInt(n, 10) });

//export const editTagcopytradesignal = makeEditor({ label: "tag name", dbKey: "tag", parse: s => s.trim() });
// export const editSignalcopytradesignal = makeEditor({ label: "signal channel", dbKey: "signal", parse: s => s.trim() });
// export const editStopLosscopytradesignal = makeEditor({ label: "stop‑loss (%)", dbKey: "sl", parse: Number });
// export const editTakeProfitcopytradesignal = makeEditor({ label: "take‑profit (%)", dbKey: "tp", parse: Number });


const editStopLosscopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {
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
      const input = parseFloat(n_msg.text);
      if (isNaN(input) || input < 0) {
        await botInstance.sendMessage(chatId, "❌ Invalid input. SL must be a number. Try again.");
        return editStopLosscopytradesignal(chatId, replaceId, dbId);
      }
      await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), sl: parseFloat(copytradedb.extractAddress(n_msg.text)) })
      editcopytradesignal(chatId, replaceId, dbId);
    }
  });
}

const editTakeProfitcopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {
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

    const input = parseFloat(n_msg.text);
    if (isNaN(input) || input <= 0) {
      await botInstance.sendMessage(chatId, "❌ Invalid input. TP must be a positive number (e.g., 50). Try again.");
      return editTakeProfitcopytradesignal(chatId, replaceId, dbId);
    }

    await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), tp: parseFloat(copytradedb.extractAddress(n_msg.text)) })
    editcopytradesignal(chatId, replaceId, dbId);
  });
}

const editActivitycopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {

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


export const getAllTrades = async () => {
  try {
    return await Trade.find({}).sort({ _id: -1 });
  } catch (error) {
    console.log("Error fetching all trades", error);
    return [];
  }
};


export const onSignal = async (chat_id: string, address: string) => {
  try {
    logger.info(`copytrade: onSignal chat ${chat_id}`, { chat: chat_id, address: address });

    // get the users signals
    const allTrades = await getAllTrades();

    const activeTrades = allTrades
      .filter(trade => trade.active);
    logger.info(`total active signals: ${activeTrades.length}`);

    // find the matching active signals
    const matchingTrades = allTrades
      .filter(trade => String(trade.signalChatId) === chat_id && trade.active);
    logger.info(`copytrade: matching signals ${matchingTrades.length}  all signals in DB ${allTrades.length}`, { matchingTrades: matchingTrades.length });

    // trigger auto trade copytrade onSignal
    matchingTrades.forEach(trade => {
      logger.info("copytrade: set auto trade for", { id: trade.chatId, address, tradeId: trade._id });
      setAutotradeSignal(trade.chatId, address, trade);
    });
  }
  catch (error) {
    logger.error("error onsignal", { chat_id, address });
  }

};