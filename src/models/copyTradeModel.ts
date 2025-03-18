import mongoose, { Schema, model, Document } from 'mongoose';
import TelegramBot from 'node-telegram-bot-api';

export interface ITrade extends Document {
  chatId: number;
  signal: string[];
}

const TradeSchema: Schema = new Schema({
  chatId: { type: Number, required: true, unique: true },
  signal: { type: Array<String>, required: true, unique: true }
});

export const Trade = model<ITrade>('copytrade', TradeSchema);

export const addTrade = async (chatId: TelegramBot.ChatId, signal: string) => {
  try {
    let copytrade = await Trade.findOne({ chatId: Number(chatId) });
    if (copytrade) {
      copytrade.signal = [...copytrade.signal, signal];
      await copytrade.save();
    } else {
      const trade = new Trade({ chatId, signal: [signal] });
      await trade.save();
    }
  } catch (error) {
    console.log("Add Copy Trade Error", error)
  }
}

export const removeTrade = async (chatId: TelegramBot.ChatId, index: number) => {
  try {
    let copytrade = await Trade.findOne({ chatId: Number(chatId) });
    if (copytrade) {
      copytrade.signal = copytrade.signal.filter((_, i) => i !== index - 1);
      await copytrade.save();
    }
  } catch (error) {
    console.log("Add Copy Trade Error", error)
  }
}

export const getTradeByChatId = async (chatId: TelegramBot.ChatId) => {
  try {
    let copytrade = await Trade.findOne({ chatId: Number(chatId) });
    return copytrade ? copytrade.signal : [];
  } catch (error) {
    console.log("Error", error)
    return [];
  }
}

export const getChatIdByChannel = async (signal: string) => {
  try {
    const tradesWithSignal = await Trade.find({ signal: signal }, { chatId: 1, _id: 0 });
    const chatIds = tradesWithSignal.map(trade => trade.chatId);
    return chatIds;
  } catch (error) {
    console.log("Error", error)
    return [];
  }
}