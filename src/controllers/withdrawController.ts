import TelegramBot, { CallbackQuery } from "node-telegram-bot-api";
import * as walletdb from '../models/walletModel';
import * as solana from '../solana';
import { botInstance, getChatIdandMessageId, setState, getState, switchMenu, STATE } from "../bot";
import { getPublicKeyinFormat } from "./sellController";
import { SOLANA_CONNECTION } from "..";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  try {
    const { data: callbackData, message: callbackMessage } = query;
    if (!callbackData || !callbackMessage) return;
    if (callbackData == "withdrawC_start") {
      withdrawStart(callbackMessage.chat.id);
    } else if (callbackData.startsWith("withdrawC_show_")) {
      const token = callbackData.split('_');
      withdrawPad(callbackMessage.chat.id, callbackMessage.message_id, token[2]);
    }

  } catch (error) {
    console.log("handleCallBackQuery error:", error);
  }
}

const withdrawStart = async (chatId: number, replaceId?: number) => {
  const wallet = await walletdb.getWalletByChatId(chatId);
  if (!wallet) {
    botInstance.sendMessage(chatId!, "❌ No wallet found. Please connect a wallet first.");
    return;
  }
  const publicKey = getPublicKeyinFormat(wallet.privateKey);

  // Fetch all tokens in the wallet
  const tokenAccounts = await solana.getAllTokensWithBalance(SOLANA_CONNECTION, publicKey);

  if (!tokenAccounts || tokenAccounts.length === 0) {
    botInstance.sendMessage(chatId!, "⚠️ No tokens found in your wallet.");
    return;
  }
  let tokenList = ''
  // Generate buttons for each token
  tokenAccounts.forEach((token, index) => [
    tokenList += `${index + 1} : ${token.name}(${token.symbol}): ${token.balance} ${token.symbol}\n`
  ]);

  const caption = "<b>Select a token to withdraw\n\n</b>" + tokenList;

  const Keyboard = tokenAccounts.map((token, index) => {
    return [
      {
        text: `${index + 1}: ${token.name}(${token.symbol})`,
        command: `withdrawC_show_${token.address}`,
      },
    ];
  });

  const keyboardList = Keyboard.concat([
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
}

const withdrawPad = async (chatId: number, replaceId: number, tokenAddress: string) => {
  const wallet = await walletdb.getWalletByChatId(chatId);
  const publicKey = getPublicKeyinFormat(wallet!.privateKey);
  const tokenInfo = await solana.getTokenInfofromMint(publicKey, tokenAddress)
  const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
  const caption = `<b>Withdraw ${metaData?.name}(${metaData?.symbol})\n\n</b>
  Balance: ${tokenInfo?.uiAmount} ${metaData?.symbol}`;

  const keyboard = [[{
    text: `50 %`,
    command: `withdrawC_send_50`,
  }, {
    text: `100 %`,
    command: `withdrawC_send_100`,
  }, {
    text: `X %`,
    command: `withdrawC_send_x`,
  },], [{
    text: `X ${metaData?.symbol}`,
    command: `withdrawC_send_xm`,
  }], [
    {
      text: `Withdraw`,
      command: `withdrawC_withdraw`,
    },
  ], [
    {
      text: `👈 Back`,
      command: `withdrawC_back`,
    },
  ]
  ];

  const reply_markup = {
    inline_keyboard: keyboard.map((rowItem) =>
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
}
