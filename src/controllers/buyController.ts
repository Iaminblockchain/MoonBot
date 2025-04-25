import TelegramBot from "node-telegram-bot-api";
import { botInstance, getChatIdandMessageId, setState, STATE, setDeleteMessageId, getDeleteMessageId, trade, setTradeState } from "../bot";
import { SOLANA_CONNECTION } from "..";
import * as walletdb from '../models/walletModel';
import * as tradedb from '../models/tradeModel';
import * as solana from '../solana/trade';
import { getPrice } from "./autoBuyController";
import { logger } from "../logger";
import { getSolBalance } from "../solana/util";
import { getTokenMetaData } from "../solana/token";

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
    logger.error("handleCallBackQuery error", { error });
  }
}

const onClickBuy = async (
  query: TelegramBot.CallbackQuery,
  amountSol: number
): Promise<void> => {
  const { chatId } = getChatIdandMessageId(query);
  try {
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);
    if (!wallet || !trade) {
      logger.warn('onClickBuy skipped: missing wallet or trade', { chatId });
      return;
    }

    logger.info('onClickBuy initiated', { chatId, amountSol, token: trade.tokenAddress });
    await botInstance.sendMessage(chatId!, 'Sending buy transaction');

    const lamports = amountSol * 10 ** 9;
    logger.info("call jupyter swap");
    const result = await solana.jupiter_swap(
      SOLANA_CONNECTION,
      wallet.privateKey,
      solana.WSOL_ADDRESS,
      trade.tokenAddress,
      lamports,
      'ExactIn',
      false
    );

    if (result.confirmed) {
      const trxLink = result.txSignature ? `http://solscan.io/tx/${result.txSignature}` : 'N/A';
      logger.info('onClickBuy success', { chatId, txSignature: result.txSignature });
      const msg = await getBuySuccessMessage(trxLink, trade.tokenAddress, amountSol);
        botInstance.sendMessage(chatId!, msg);
    } else {
      logger.error('onClickBuy failed: not confirmed', { chatId, result });
      await botInstance.sendMessage(chatId!, 'Buy failed');
    }
  } catch (error: any) {
    logger.error('onClickBuy error', { error, chatId });
    const msg = (error.message || '').toLowerCase();
    const reply = msg.includes('insufficient') || msg.includes('balance')
      ? 'Buy failed: insufficient balance'
      : 'Buy failed due to error';
    await botInstance.sendMessage(chatId!, reply);
  }
};

// Specific handlers using the generic function
export const onClickHalfBuy = (query: TelegramBot.CallbackQuery) => onClickBuy(query, 0.5);
export const onClickOneBuy = (query: TelegramBot.CallbackQuery) => onClickBuy(query, 1);

const onClickXBuy = (query: TelegramBot.CallbackQuery) => {
  const { chatId } = getChatIdandMessageId(query);
  setState(chatId!, STATE.INPUT_BUY_AMOUNT);
  botInstance.sendMessage(chatId!, 'Input buy amount');
}

export const buyXAmount = async (message: TelegramBot.Message) => {
  try {
    const chatId = message.chat.id;

    const amount = parseFloat(message.text!);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && trade) {
      botInstance.sendMessage(chatId!, 'Sending buy transaction');
      logger.info("Sending buy transaction:", { tokenAddress: trade.tokenAddress });

      let result = await solana.jupiter_swap(SOLANA_CONNECTION, wallet.privateKey, solana.WSOL_ADDRESS, trade.tokenAddress, parseInt((amount * 10 ** 9).toString()), "ExactIn", false);
      if (result.confirmed) {
        logger.info(`confirmed ${result}`);
        let trx = "";
        if (result.txSignature) {
          trx = `http://solscan.io/tx/${result.txSignature}`
        }
        const msg = await getBuySuccessMessage(trx, trade.tokenAddress, amount);
        botInstance.sendMessage(chatId!, msg);
      } else {
        logger.error(`buy failed ${result}`);
        botInstance.sendMessage(chatId!, 'Buy failed');
      }
    }
  } catch (error: any) {
    logger.error("buyXAmount error", { error });
    const chatId = message.chat.id;
    const msg = error.message?.toLowerCase() || "";
    if (msg.includes("insufficient") || msg.includes("balance")) {
      botInstance.sendMessage(chatId, "Buy failed: insufficient balance");
    } else {
      botInstance.sendMessage(chatId, "Buy failed due to error");
    }
  }
}

export const showBuyPad = async (message: TelegramBot.Message) => {
  try {
    const chatId = message.chat.id;
    const tokenAddress = message.text;
    const metaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress!);
    const wallet = await walletdb.getWalletByChatId(chatId);
    const balance = await getSolBalance(wallet!.privateKey);
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
    logger.info("buy token address: ", { manualBuyTokenAddress: tokenAddress })
    tradedb.createTrade(chatId, tokenAddress!);
    botInstance.deleteMessage(chatId, getDeleteMessageId(chatId));
  } catch (error) {
    logger.error("showBuyPad error", { error });
    const chatId = message.chat.id;
    botInstance.sendMessage(chatId, "Failed to display buy options");
  }
}

const onBuyControlStart = async (query: TelegramBot.CallbackQuery) => {
  try {
    const { chatId, messageId } = getChatIdandMessageId(query);
    setState(chatId!, STATE.INPUT_TOKEN);
    botInstance.sendMessage(chatId!, 'Enter token address to buy.', { parse_mode: 'HTML' }).then((message: any) => {
      const messageId = message.message_id;
      setDeleteMessageId(chatId!, messageId!);
    });
  } catch (error) {
    logger.error('onClickTokenLaunchButton, error: ', { error });
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
  chatId: string,
  settings: {
    amount: number;
    isPercentage: boolean;
    maxSlippage: number;
    takeProfit: number | null;
    repetitiveBuy: number;
    stopLoss: number | null;
  },
  contractAddress: string,
  tradeSignal?: string
) => {
  try {
    const wallet = await walletdb.getWalletByChatId(chatId);
    if (!wallet) {
      botInstance.sendMessage(chatId, "Wallet not found. Please create or import a wallet first.");
      return;
    }
    logger.info("run auto buy", { settings: settings, contractAddress: contractAddress, chatId: chatId });
    const balance = await getSolBalance(wallet.privateKey);
    let solAmount = settings.amount;
    if (settings.isPercentage) {
      solAmount = (balance * settings.amount) / 100;
    }
    if (solAmount > balance) {
      logger.error('Insufficient SOL balance', { chatId, balance, required: solAmount });
      botInstance.sendMessage(
        chatId,
        `❌ Insufficient SOL balance: you have ${balance.toFixed(6)} SOL but need ${solAmount.toFixed(6)} SOL.`
      );
      return;
    }

    const buyNumber = getBuynumber(chatId.toString(), contractAddress);
    if (buyNumber >= settings.repetitiveBuy) {
      logger.info("max repeat reached");
      return;
    };

    const metaData = await getTokenMetaData(SOLANA_CONNECTION, contractAddress)
    let trade_type = tradeSignal ? "CopyTrade buy" : "Auto-buy";
    logger.info(`${trade_type}: Sending buy transaction for Token  ${metaData?.name}(${metaData?.symbol}) : ${contractAddress} with amount ${solAmount} SOL ${tradeSignal ? `from signal @${tradeSignal} ` : ''}(Max Slippage: ${settings.maxSlippage}%)`)
    botInstance.sendMessage(
      chatId,
      `${trade_type}: Sending buy transaction for Token  ${metaData?.name}(${metaData?.symbol}) : ${contractAddress} with amount ${solAmount} SOL ${tradeSignal ? `from signal @${tradeSignal} ` : ''}(Max Slippage: ${settings.maxSlippage}%)`
    );

    let result = await solana.jupiter_swap(SOLANA_CONNECTION, wallet.privateKey, solana.WSOL_ADDRESS, contractAddress, solAmount * 10 ** 9, "ExactIn", false, settings.maxSlippage * 100)

    if (result.confirmed) {
      let trx = result.txSignature ? `http://solscan.io/tx/${result.txSignature}` : "";
      const msg = await getBuySuccessMessage(trx, contractAddress, solAmount, trade_type, tradeSignal, settings);
      botInstance.sendMessage(chatId, msg);
      if (settings.takeProfit != null && settings.stopLoss) {
        logger.info("set take profit");
        const splprice = await getPrice(contractAddress);
        // TODO: Update SPL Price
        //TODO split TP and SL
        botInstance.sendMessage(chatId, `Auto-sell Registered: ${contractAddress}, Current Price: ${splprice}, TakeProfit Price: ${(splprice * (100 + settings.takeProfit) / 100)}(${settings.takeProfit}%), StopLoss Price: ${splprice * (100 - settings.stopLoss) / 100}(${settings.stopLoss}%)`);
        //set SL and TP in DB which will be queried
        setTradeState(chatId, contractAddress, splprice, splprice * (100 + settings.takeProfit) / 100, splprice * (100 - settings.stopLoss) / 100);
        AddBuynumber(chatId.toString(), contractAddress);
      }

    } else {
      logger.error(`${trade_type} failed. result ${result}`)
      botInstance.sendMessage(chatId, `${trade_type} failed.`);
    }
  } catch (error) {
    logger.error(`autobuy error ${error}`, { chatId, settings, contractAddress, tradeSignal });
  }
};


const getBuySuccessMessage = async (
  trx: string,
  tokenAddress: string,
  solAmount: number,
  trade_type?: string,
  tradeSignal?: string,
  settings?: {
    amount: number;
    isPercentage: boolean;
    maxSlippage: number;
    takeProfit: number | null;
    repetitiveBuy: number;
    stopLoss: number | null;
  },
) => {
  const metaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
  if (!trade_type) {
    return `Buy successful: ${trx}\nTicker: ${metaData?.symbol}\nBuy Amount: ${solAmount} SOL`;
  } else if (settings) {
    return `${trade_type} successful: ${trx}\nBuy Amount: ${solAmount} SOL\nTicker: ${metaData?.symbol}\nSource:${tradeSignal ? `$@{tradeSignal}` : ""}\nTake profit:${settings!.takeProfit}%, Stop loss:${settings!.stopLoss}%`
  } else {
    return `${trade_type} successful: ${trx}\nBuy Amount: ${solAmount} SOL\nTicker: ${metaData?.symbol}\nSource:${tradeSignal ? `$@{tradeSignal}` : ""}`
  }
}