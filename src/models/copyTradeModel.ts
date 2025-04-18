import mongoose, { Schema, model, Document } from "mongoose";
import TelegramBot from "node-telegram-bot-api";

export interface ITrade extends Document {
  chatId: string;
  tag: string | null;
  signal: string;
  signalChatId: string;
  amount: number;
  maxSlippage: number;
  tp: number;
  sl: number;
  repetitiveBuy: number;
  active: boolean;
}

const TradeSchema: Schema = new Schema({
  chatId: { type: String, required: true },
  tag: { type: String, default: "", nullable: true },
  signal: { type: String, default: "" },
  signalChatId: { type: String, default: null, nullable: true },
  amount: { type: Number, default: 0 },
  maxSlippage: { type: Number, default: 5 },
  tp: { type: Number, default: null },
  sl: { type: Number, default: null },
  repetitiveBuy: { type: Number, default: 1 },
  active: { type: Boolean, default: false },
});

// TradeSchema.index({ chatId: 1, signal: 1 }, { unique: true });

export const Trade = model<ITrade>("copytrade", TradeSchema);

export const addTrade = async (chatId: TelegramBot.ChatId) => {
  try {
    const trade = await Trade.create({ chatId });
    return trade;
  } catch (error) {
    console.log("Add Copy Trade Error", error);
  }
};

export const removeTrade = async (props: any) => {
  try {
    await Trade.findOneAndDelete(props);
    return true;
  } catch (error) {
    console.log("Add Copy Trade Error", error);
    return false;
  }
};

export const updateTrade = async (props: any) => {
  try {
    const { id } = props;
    let copytrade = await Trade.findByIdAndUpdate(id, props);
    return copytrade;
  } catch (error) {
    console.log("Add Copy Trade Error", error);
  }
};

export const findAndUpdateOne = async (filter: any, props: any) => {
  try {
    const result = await Trade.findOneAndUpdate(filter, props, { new: true, upsert: false });
    return result;
  } catch (err: any) {
    throw new Error(err.message);
  }
}

export const findTrade = async (props: any) => {
  try {
    let copytrade = await Trade.findOne(props);
    return copytrade;
  } catch (error) {
    console.log("Add Copy Trade Error", error);
  }
};

export const getTradeByChatId = async (chatId: TelegramBot.ChatId) => {
  try {
    const copytrade = await Trade.find({ chatId });
    return copytrade;
  } catch (error) {
    console.log("Error", error);
    return [];
  }
};

export const getChatIdByChannel = async (sig: string) => {
  try {
    const signal = extractAddress(sig.trim());
    const tradesWithSignal = await Trade.find({ signal: signal });
    const chatIds = tradesWithSignal.map((trade) => trade.chatId);
    return chatIds;
  } catch (error) {
    console.log("Error", error);
    return [];
  }
};

export const getAllActiveChannels = async () => {
  try {
    const tradesWithSignal = await Trade.find({ active: true });
    const signals = tradesWithSignal.map((trade) => trade.signal);
    return signals;
  } catch (error) {
    console.log("Error", error);
    return [];
  }
};

export const extractAddress = (input: string) => {
  if (input.startsWith("https://t.me/")) {
    return input.substring(input.lastIndexOf("/") + 1);
  } else if (input.startsWith("@")) {
    return input.substring(1);
  } else if (input.endsWith("%")) {
    return input.slice(0, -1);
  }
  return input;
};
