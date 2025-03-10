import TelegramBot from "node-telegram-bot-api";
import { botInstance, setState, STATE, getChatIdandMessageId, setDeleteMessageId, getDeleteMessageId, removeState } from "../bot";
import { SOLANA_CONNECTION } from "../config";
import * as walletdb from "../models/walletModel";
import * as tradedb from "../models/tradeModel";
import * as solana from "../solana";
const { PublicKey } = require('@solana/web3.js'); // Import PublicKey

// Define onBuyControlStart first.
const onBuyControlStart = async (query: TelegramBot.CallbackQuery) => {
  try {
    const { chatId } = getChatIdandMessageId(query);
    setState(chatId!, STATE.INPUT_TOKEN);
    botInstance
      .sendMessage(chatId!, "Enter token address to buy.", { parse_mode: "HTML" })
      .then((message) => {
        const messageId = message.message_id;
        setDeleteMessageId(chatId!, messageId!);
      });
  } catch (error) {
    console.log("onBuyControlStart, error: " + error);
  }
};

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  try {
    const data = query.data;
    if (data === "buyController_start") {
      onBuyControlStart(query);
    } else if (data === "buyController_0.5buy") {
      onClickHalfBuy(query);
    } else if (data === "buyController_1.0buy") {
      onClickOneBuy(query);
    } else if (data === "buyController_Xbuy") {
      onClickXBuy(query);
    }
  } catch (error) {
    console.log(error);
  }
};

const onClickHalfBuy = async (query: TelegramBot.CallbackQuery) => {
  const { chatId } = getChatIdandMessageId(query);
  const wallet = await walletdb.getWalletByChatId(chatId!);
  const trade = await tradedb.getTradeByChatId(chatId!);
  if (wallet && trade) {
    const privateKey = wallet.privateKey;
    const publicKey = solana.getPublicKey(privateKey);
    botInstance.sendMessage(chatId!, "Sending buy transaction");
    var result = await solana.swapToken(
      SOLANA_CONNECTION,
      privateKey,
      publicKey,
      solana.WSOL_ADDRESS,         // Pass as string
      trade.tokenAddress,          // Pass as string
      0.5,
      "ExactIn"
    );
    if (result.confirmed) {
      let trx = result.signature ? `http://solscan.io/tx/${result.signature}` : "";
      botInstance.sendMessage(chatId!, `Buy successfully: ${trx}`);
    } else {
      botInstance.sendMessage(chatId!, "Buy failed");
    }
  }
};

const onClickOneBuy = async (query: TelegramBot.CallbackQuery) => {
  const { chatId } = getChatIdandMessageId(query);
  const wallet = await walletdb.getWalletByChatId(chatId!);
  const trade = await tradedb.getTradeByChatId(chatId!);
  if (wallet && trade) {
    const privateKey = wallet.privateKey;
    const publicKey = solana.getPublicKey(privateKey);
    botInstance.sendMessage(chatId!, "Sending buy transaction");
    var result = await solana.swapToken(
      SOLANA_CONNECTION,
      privateKey,
      publicKey,
      solana.WSOL_ADDRESS,
      trade.tokenAddress,
      1,
      "ExactIn"
    );
    if (result.confirmed) {
      let trx = result.signature ? `http://solscan.io/tx/${result.signature}` : "";
      botInstance.sendMessage(chatId!, `Buy successfully: ${trx}`);
    } else {
      botInstance.sendMessage(chatId!, "Buy failed");
    }
  }
};

const onClickXBuy = (query: TelegramBot.CallbackQuery) => {
  const { chatId } = getChatIdandMessageId(query);
  setState(chatId!, STATE.INPUT_BUY_AMOUNT);
  botInstance.sendMessage(chatId!, "Input buy amount");
};

export const buyXAmount = async (message: TelegramBot.Message) => {
  const chatId = message.chat.id;
  const amount = parseFloat(message.text!);
  console.log("input amount", amount);
  const wallet = await walletdb.getWalletByChatId(chatId!);
  const trade = await tradedb.getTradeByChatId(chatId!);
  if (wallet && trade) {
    const privateKey = wallet.privateKey;
    const publicKey = solana.getPublicKey(privateKey);
    botInstance.sendMessage(chatId!, "Sending buy transaction");
    var result = await solana.swapToken(
      SOLANA_CONNECTION,
      privateKey,
      publicKey,
      solana.WSOL_ADDRESS,
      trade.tokenAddress,
      amount,
      "ExactIn"
    );
    if (result.confirmed) {
      let trx = result.signature ? `http://solscan.io/tx/${result.signature}` : "";
      botInstance.sendMessage(chatId!, `Buy successfully: ${trx}`);
    } else {
      botInstance.sendMessage(chatId!, "Buy failed");
    }
  }
};

export const showBuyPad = async (message: TelegramBot.Message) => {
  try {
    const chatId = message.chat.id;
    const tokenAddress = message.text;
    const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, tokenAddress!);
    const wallet = await walletdb.getWalletByChatId(chatId);
    const balance = await solana.getSolBalance(wallet!.privateKey);
    const title = `<b>Buy</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${tokenAddress}</code>\n\nBalance: ${balance} SOL`;
    const buttons = [
      [
        { text: "Buy 0.5 SOL", callback_data: "buyController_0.5buy" },
        { text: "Buy 1.0 SOL", callback_data: "buyController_1.0buy" },
        { text: "Buy X SOL", callback_data: "buyController_Xbuy" }
      ],
      [{ text: "Refresh", callback_data: "buyController_refresh" }]
    ];
    botInstance.sendMessage(chatId, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: "HTML" });
    tradedb.createTrade(chatId, tokenAddress!);
    const msgId = getDeleteMessageId(chatId);
    if (msgId !== undefined) {
      botInstance.deleteMessage(chatId, msgId);
    }
  } catch (error) {
    console.log(error);
  }
};

export const autoBuyContract = async (
  msg: TelegramBot.Message,
  settings: { amount: number; isPercentage: boolean; maxSlippage: number },
  contractAddress: string
) => {
  const chatId = msg.chat.id;
  const wallet = await walletdb.getWalletByChatId(chatId);
  if (!wallet) {
    botInstance.sendMessage(chatId, "Wallet not found. Please create or import a wallet first.");
    return;
  }
  let solAmount = settings.amount;
  if (settings.isPercentage) {
    const balance = await solana.getSolBalance(wallet.privateKey);
    solAmount = (balance * settings.amount) / 100;
  }
  const publicKey = solana.getPublicKey(wallet.privateKey);
  botInstance.sendMessage(
    chatId,
    `Auto-buy: Sending buy transaction for token ${contractAddress} with ${solAmount} SOL (Max Slippage: ${settings.maxSlippage}%)`
  );
  var result = await solana.swapToken(
    SOLANA_CONNECTION,
    wallet.privateKey,
    publicKey,
    solana.WSOL_ADDRESS,
    contractAddress,
    solAmount,
    "ExactIn"
  );
  if (result.confirmed) {
    let trx = result.signature ? `http://solscan.io/tx/${result.signature}` : "";
    botInstance.sendMessage(chatId, `Auto-buy successful: ${trx}`);
  } else {
    botInstance.sendMessage(chatId, "Auto-buy failed.");
  }
};
