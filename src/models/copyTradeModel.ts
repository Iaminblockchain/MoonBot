import mongoose, { Schema, model, Document } from "mongoose";
import TelegramBot from "node-telegram-bot-api";

export interface ITrade extends Document {
  chatId: number;
  tag: string | null;
  signal: string;
  amount: string;
  maxSlippage: number;
  tp: number;
  sl: number;
  repetitiveBuy: number;
  active: boolean;
}

const TradeSchema: Schema = new Schema({
  chatId: { type: Number, required: true },
  tag: { type: String, default: "", nullable: true },
  signal: { type: String, default: "" },
  amount: { type: Number, default: 0 },
  maxSlippage: { type: Number, default: 5 },
  tp: { type: Number, default: 0 },
  sl: { type: Number, default: 0 },
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
    const { id } = props;
    await Trade.findByIdAndDelete(id);
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

export const findTrade = async (props: any) => {
  try {
    const { id } = props;
    let copytrade = await Trade.findOne(id);
    return copytrade;
  } catch (error) {
    console.log("Add Copy Trade Error", error);
  }
};

export const getTradeByChatId = async (chatId: TelegramBot.ChatId) => {
  try {
    let copytrade = await Trade.find({ chatId: Number(chatId) });
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

const extractAddress = (input: string) => {
  if (input.startsWith("https://t.me/")) {
    return input.substring(input.lastIndexOf("/") + 1);
  } else if (input.startsWith("@")) {
    return input.substring(1);
  }
  return input;
};
