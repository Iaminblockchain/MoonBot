import TelegramBot from "node-telegram-bot-api";
import { botInstance, switchMenu, getChatIdandMessageId, setState, STATE, setDeleteMessageId, getDeleteMessageId, trade, setTradeState } from "../bot";
import { SOLANA_CONNECTION } from "..";
import * as walletdb from '../models/walletModel';
import * as tradedb from '../models/tradeModel';
import * as solana from '../solana';
import { getPrice } from "./autoBuyController";
const { PublicKey } = require('@solana/web3.js'); // Import PublicKey
import { logger } from "../util";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  try {
    const data = query.data;
    if (data == "buyController_start") {
      onBuyControlStart(query);
    } else if (data == "buyController_0.5buy") {
      onClickHalfBuy(query);
    } else if (data == "buyController_1.0buy") {
      onClickOneBuy(query);
    } else if (data == "buyController_Xbuy") {
      onClickXBuy(query);
    }
  } catch (error) {

  }

}

const onClickHalfBuy = async (query: TelegramBot.CallbackQuery) => {
  const { chatId, messageId } = getChatIdandMessageId(query);
  const wallet = await walletdb.getWalletByChatId(chatId!);
  const trade = await tradedb.getTradeByChatId(chatId!);
  if (wallet && trade) {
    const privateKey = wallet.privateKey;
    const publicKey = solana.getPublicKey(privateKey);
    botInstance.sendMessage(chatId!, 'Sending buy transaction');
    var result = await solana.swapToken(SOLANA_CONNECTION, privateKey, publicKey, new PublicKey(solana.WSOL_ADDRESS), new PublicKey(trade.tokenAddress), 0.5, "ExactIn")
    if (result.confirmed) {
      let trx = null;
      if (result.signature) {
        trx = `http://solscan.io/tx/${result.signature}`
      }
      botInstance.sendMessage(chatId!, `Buy successfully: ${trx}`);
    } else {
      botInstance.sendMessage(chatId!, 'Buy failed');
    }
  }
}

const onClickOneBuy = async (query: TelegramBot.CallbackQuery) => {
  const { chatId, messageId } = getChatIdandMessageId(query);
  const wallet = await walletdb.getWalletByChatId(chatId!);
  const trade = await tradedb.getTradeByChatId(chatId!);
  if (wallet && trade) {
    const privateKey = wallet.privateKey;
    const publicKey = solana.getPublicKey(privateKey);
    botInstance.sendMessage(chatId!, 'Sending buy transaction');
    var result = await solana.swapToken(SOLANA_CONNECTION, privateKey, publicKey, new PublicKey(solana.WSOL_ADDRESS), new PublicKey(trade.tokenAddress), 1, "ExactIn")
    if (result.confirmed) {
      let trx = null;
      if (result.signature) {
        trx = `http://solscan.io/tx/${result.signature}`
      }
      botInstance.sendMessage(chatId!, `Buy successfully: ${trx}`);
    } else {
      botInstance.sendMessage(chatId!, 'Buy failed');
    }
  }
}

const onClickXBuy = (query: TelegramBot.CallbackQuery) => {
  const { chatId, messageId } = getChatIdandMessageId(query);
  setState(chatId!, STATE.INPUT_BUY_AMOUNT);
  botInstance.sendMessage(chatId!, 'Input buy amount');
}

export const buyXAmount = async (message: TelegramBot.Message) => {
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const amount = parseFloat(message.text!);
  console.log("input amount", amount)
  const wallet = await walletdb.getWalletByChatId(chatId!);
  const trade = await tradedb.getTradeByChatId(chatId!);
  if (wallet && trade) {
    const privateKey = wallet.privateKey;
    const publicKey = solana.getPublicKey(privateKey);
    botInstance.sendMessage(chatId!, 'Sending buy transaction');
    var result = await solana.swapToken(SOLANA_CONNECTION, privateKey, publicKey, new PublicKey(solana.WSOL_ADDRESS), new PublicKey(trade.tokenAddress), amount, "ExactIn")
    if (result.confirmed) {
      let trx = null;
      if (result.signature) {
        trx = `http://solscan.io/tx/${result.signature}`
      }
      botInstance.sendMessage(chatId!, `Buy successfully: ${trx}`);
    } else {
      botInstance.sendMessage(chatId!, 'Buy failed');
    }
  }
}

export const showBuyPad = async (message: TelegramBot.Message) => {
  try {
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const tokenAddress = message.text;
    const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, tokenAddress!);
    const wallet = await walletdb.getWalletByChatId(chatId);
    const balance = await solana.getSolBalance(wallet!.privateKey);
    const title = `<b>Buy</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${tokenAddress}</code>\n\nBalance: ${balance} SOL`
    const buttons = [
      [
        { text: 'Buy 0.5 SOL', callback_data: "buyController_0.5buy" },
        { text: 'Buy 1.0 SOL', callback_data: "buyController_1.0buy" },
        { text: 'Buy X SOL', callback_data: "buyController_Xbuy" }
      ],
      [
        { text: 'Refresh', callback_data: "buyController_refresh" }
      ]
    ]
    botInstance.sendMessage(chatId, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' })
    tradedb.createTrade(chatId, tokenAddress!);
    botInstance.deleteMessage(chatId, getDeleteMessageId(chatId));

  } catch (error) {

  }

}

const onBuyControlStart = async (query: TelegramBot.CallbackQuery) => {
  try {
    const { chatId, messageId } = getChatIdandMessageId(query);
    setState(chatId!, STATE.INPUT_TOKEN);
    botInstance.sendMessage(chatId!, 'Enter token address to buy.', { parse_mode: 'HTML' }).then((message: any) => {
      const messageId = message.message_id;
      setDeleteMessageId(chatId!, messageId!);
      console.log(chatId, message)
    });
  } catch (error) {
    console.log('onClickTokenLaunchButton, error: ' + error);
  }
}
export type BuyTrade = {
  contract: string,
  buynumber: number,
}
export const buyTrades = new Map<string, BuyTrade[]>();

const getBuynumber = (chatId: string, contractAddress: string) => {
  const data = buyTrades.get(chatId);
  if (!data) return 0;
  else {
    const value = data.find((value) => value.contract === contractAddress);
    if (!value) return 0;
    else return value.buynumber
  }
}

const AddBuynumber = (chatId: string, contractAddress: string) => {
  const data = buyTrades.get(chatId);
  if (!data) buyTrades.set(chatId, [{ contract: contractAddress, buynumber: 1 }]);
  else {
    const value = data.find((value) => value.contract === contractAddress);
    if (!value) buyTrades.set(chatId, [...data, { contract: contractAddress, buynumber: 1 }])
    else {
      const others = data.filter((value) => value.contract != contractAddress);
      return buyTrades.set(chatId, [...others, { contract: contractAddress, buynumber: value.buynumber + 1 }])
    }
  }
}

export const autoBuyContract = async (
  chatId: number,
  settings: { amount: number; isPercentage: boolean; maxSlippage: number, takeProfit: number, repetitiveBuy: number, stopLoss: number },
  contractAddress: string
) => {
  const wallet = await walletdb.getWalletByChatId(chatId);
  if (!wallet) {
    botInstance.sendMessage(chatId, "Wallet not found. Please create or import a wallet first.");
    return;
  }
  logger.info("run auto buy", { settings: settings, contractAddress: contractAddress, chatId: chatId });
  let solAmount = settings.amount;
  if (settings.isPercentage) {
    const balance = await solana.getSolBalance(wallet.privateKey);
    solAmount = (balance * settings.amount) / 100;
  }
  const buyNumber = getBuynumber(chatId.toString(), contractAddress);
  if (buyNumber >= settings.repetitiveBuy) return;
  botInstance.sendMessage(
    chatId,
    `Auto-buy: Sending buy transaction for token ${contractAddress} with ${solAmount} SOL (Max Slippage: ${settings.maxSlippage}%)`
  );

  let result = await solana.jupiter_swap(SOLANA_CONNECTION, wallet.privateKey, solana.WSOL_ADDRESS, contractAddress, solAmount * 10 ** 9, "ExactIn", false, settings.maxSlippage * 100)

  if (result.confirmed) {
    let trx = result.txSignature ? `http://solscan.io/tx/${result.txSignature}` : "";
    botInstance.sendMessage(chatId, `Auto-buy successful: ${trx}`);
    const splprice = await getPrice(contractAddress);
    // TODO: Update SPL Price
    botInstance.sendMessage(chatId!, `Auto-sell Registered: ${contractAddress}, Current Price: ${splprice}, TakeProfit Price: ${(splprice * (100 + settings.takeProfit) / 100)}, StopLoss Price: ${splprice * (100 - settings.stopLoss) / 100}`);
    setTradeState(chatId, contractAddress, splprice * (100 + settings.takeProfit) / 100, splprice * (100 - settings.stopLoss) / 100);
    AddBuynumber(chatId.toString(), contractAddress);
  } else {
    botInstance.sendMessage(chatId, "Auto-buy failed.");
  }
};
