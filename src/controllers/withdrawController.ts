import TelegramBot, { CallbackQuery } from "node-telegram-bot-api";
import * as walletdb from '../models/walletModel';
import * as solana from '../solana/trade';
import { botInstance, getChatIdandMessageId, setState, getState, switchMenu, STATE } from "../bot";
import { getPublicKeyinFormat } from "./sellController";
import { SOLANA_CONNECTION } from "..";
import { logger } from "../logger";
import { sendSPLtokens, getTokenInfofromMint, getTokenMetaData } from "../solana/token";
import { getSolBalance, isValidAddress } from "../solana/util";

type WithdrawSettingType = {
  amount?: number;
  isPercentage?: boolean;
  tokenAddress?: string;
}

export const withdrawSetting = new Map<string, WithdrawSettingType[]>();

const getWithdrawSetting = (chatId: string, tokenAddress: string) => {
  const rest = withdrawSetting.get(chatId);
  if (rest) {
    const tokenSetting = rest.find(setting => setting.tokenAddress === tokenAddress);
    if (tokenSetting) {
      return tokenSetting;
    } else {
      withdrawSetting.set(chatId, [...rest, { tokenAddress }])
      return { tokenAddress };
    }
  } else {
    withdrawSetting.set(chatId, [{ tokenAddress }])
    return { tokenAddress };
  }
}

const setWithdarwSettingAmount = (chatId: string, tokenAddress: string, amount: number, isPercentage: boolean) => {
  const rest = withdrawSetting.get(chatId);
  if (rest) {
    const tokenSetting = rest.find(setting => setting.tokenAddress === tokenAddress);
    if (tokenSetting) {
      const restTokenSetting = rest.filter(setting => setting.tokenAddress !== tokenAddress);
      withdrawSetting.set(chatId, [...restTokenSetting, { tokenAddress, amount, isPercentage }]);
    } else {
      withdrawSetting.set(chatId, [...rest, { tokenAddress, amount, isPercentage }]);
    }
  } else {
    withdrawSetting.set(chatId, [{ tokenAddress, amount, isPercentage }]);
  }
}

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  if (!botInstance) {
    logger.error("Bot instance not initialized in withdrawController.handleCallBackQuery");
    return;
  }

  try {
    const { data: callbackData, message: callbackMessage } = query;
    if (!callbackData || !callbackMessage) return;
    if (callbackData == "wC_start") {
      withdrawStart(String(callbackMessage.chat.id));
    } else if (callbackData.startsWith("wC_show_")) {
      const token = callbackData.split('_');
      withdrawPad(String(callbackMessage.chat.id), callbackMessage.message_id, token[2]);
    } else if (callbackData.startsWith("wC_set_")) {
      const setting = callbackData.split('_');
      setWithdrawAmount(String(callbackMessage.chat.id), callbackMessage.message_id, setting[2], setting[3]);
    } else if (callbackData.startsWith("wC_withdraw_")) {
      const token = callbackData.split('_');
      sendWithdraw(String(callbackMessage.chat.id), query.id, token[2])
    } else if (callbackData == "wC_back") {
      withdrawStart(String(callbackMessage.chat.id), callbackMessage.message_id);
    }

  } catch (error) {
    logger.error("handleCallBackQuery error:", { error });
  }
}

const withdrawStart = async (chatId: string, replaceId?: number) => {
  if (!botInstance) {
    logger.error("Bot instance not initialized in withdrawStart");
    return;
  }

  try {
    const wallet = await walletdb.getWalletByChatId(chatId);
    if (!wallet) {
      botInstance.sendMessage(chatId, "❌ No wallet found. Please connect a wallet first.");
      return;
    }
    const publicKey = getPublicKeyinFormat(wallet.privateKey);

    // Fetch all tokens in the wallet
    const tokenAccounts = await solana.getAllTokensWithBalance(SOLANA_CONNECTION, publicKey);

    if (!tokenAccounts || tokenAccounts.length === 0) {
      botInstance.sendMessage(chatId, "⚠️ No tokens found in your wallet.");
      return;
    }
    let tokenList = ''
    // Generate buttons for each token
    tokenAccounts.forEach((token, index) => [
      tokenList += `${index + 1} : ${token.name}(${token.symbol}): ${token.balance} ${token.symbol}\n`
    ]);

    const balance = await getSolBalance(wallet.privateKey);

    const caption = `<b>Select a token to withdraw\n\n</b>0 : Native Sol (${balance}sol)\n` + tokenList;

    const Keyboard = tokenAccounts.map((token, index) => {
      return [
        {
          text: `${index + 1}: ${token.name}(${token.symbol})`,
          command: `wC_show_${token.address}`,
        },
      ];
    });

    const keyboardList = [[{ text: "0: Native Sol", command: "wC_show_sol" }]].concat(Keyboard).concat([
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
  } catch (e) {
    logger.error("withdrawStart Error", { error: e });
  }
}

const withdrawPad = async (chatId: string, replaceId: number, tokenAddress: string) => {
  if (!botInstance) {
    logger.error("Bot instance not initialized in withdrawPad");
    return;
  }

  try {
    const wallet = await walletdb.getWalletByChatId(chatId);
    if (!wallet) {
      botInstance.sendMessage(chatId, "❌ No wallet found. Please connect a wallet first.");
      return;
    }
    const isNativeSol = tokenAddress == "sol" ? true : false;
    let caption = "";
    let metaData: any;
    if (!isNativeSol) {
      const publicKey = getPublicKeyinFormat(wallet.privateKey);
      const tokenInfo = await getTokenInfofromMint(publicKey, tokenAddress)
      metaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
      caption = `<b>Withdraw ${metaData?.name}(${metaData?.symbol})\n\n</b>Balance: ${tokenInfo?.uiAmount} ${metaData?.symbol}`;
    } else {
      const solBalance = await getSolBalance(wallet.privateKey);
      caption = `<b>Withdraw native Sol token\n\n</b>Balance: ${solBalance}(sol)`;
    }
    const withdrawSettingToken = getWithdrawSetting(chatId, tokenAddress);

    const keyboard = (withdrawsetting: WithdrawSettingType) => [[{
      text: `${withdrawsetting.amount == 50 && withdrawsetting.isPercentage ? "✅ 50 %" : "50 %"}`,
      command: `wC_set_50_${withdrawsetting.tokenAddress}`,
    }, {
      text: `${withdrawsetting.amount == 100 && withdrawsetting.isPercentage ? "✅ 100 %" : "100 %"}`,
      command: `wC_set_100_${withdrawsetting.tokenAddress}`,
    }, {
      text: `${withdrawsetting.amount !== 50 && withdrawsetting.amount !== 100 && withdrawsetting.amount && withdrawsetting.isPercentage ? `✅ ${withdrawsetting.amount} %` : "X %"}`,
      command: `wC_set_x_${withdrawsetting.tokenAddress}`,
    },], [{
      text: `${withdrawsetting.amount && withdrawsetting.isPercentage == false ? `✅ ${withdrawsetting.amount} ${isNativeSol ? "Sol" : metaData?.symbol}` : `X ${isNativeSol ? "Sol" : metaData?.symbol}`}`,
      command: `wC_set_xm_${withdrawsetting.tokenAddress}`,
    }], [
      {
        text: `Withdraw`,
        command: `wC_withdraw_${withdrawsetting.tokenAddress}`,
      },
    ], [
      {
        text: `👈 Back`,
        command: `wC_back`,
      },
    ]
    ];

    const reply_markup = {
      inline_keyboard: keyboard(withdrawSettingToken).map((rowItem) =>
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
  } catch (e) {
    logger.error("withdrawPad Error", { error: e });
  }
}

const setWithdrawAmount = async (chatId: string, replaceId: number, identifier: string, tokenAddress: string) => {
  if (!botInstance) {
    logger.error("Bot instance not initialized in setWithdrawAmount");
    return;
  }

  if (identifier == "50") {
    setWithdarwSettingAmount(chatId, tokenAddress, 50, true)
    withdrawPad(chatId, replaceId, tokenAddress);
    return;
  } else if (identifier == "100") {
    setWithdarwSettingAmount(chatId, tokenAddress, 100, true)
    withdrawPad(chatId, replaceId, tokenAddress);
    return;
  }

  const caption = `<b>Please type token amount to withdraw</b>\n\n`;
  const reply_markup = {
    force_reply: true,
  };
  const new_msg = await botInstance.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup,
  });
  botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
    if (!botInstance) {
      logger.error("Bot instance not initialized in setWithdrawAmount onReplyToMessage callback");
      return;
    }

    botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
    botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

    if (n_msg.text) {
      if (identifier == "x") {
        setWithdarwSettingAmount(chatId, tokenAddress, parseFloat(n_msg.text), true)
        withdrawPad(chatId, replaceId, tokenAddress);
        return;
      } else if (identifier == "xm") {
        setWithdarwSettingAmount(chatId, tokenAddress, parseFloat(n_msg.text), false)
        withdrawPad(chatId, replaceId, tokenAddress);
        return;
      }
    }
  });
}

const sendWithdraw = async (chatId: string, queryId: string, tokenAddress: string) => {
  if (!botInstance) {
    logger.error("Bot instance not initialized in sendWithdraw");
    return;
  }

  const withdrawsetting = getWithdrawSetting(chatId, tokenAddress)
  if (!withdrawsetting.amount || withdrawsetting.isPercentage == null || withdrawsetting.isPercentage == undefined) {
    botInstance.answerCallbackQuery({
      callback_query_id: queryId,
      text: "Please try again after setting withdraw Amount.",
      show_alert: false,
    });
    return;
  } else {
    const caption = `<b>Please type destination wallet address to withdraw</b>\n\n`;
    const reply_markup = {
      force_reply: true,
    };
    const new_msg = await botInstance.sendMessage(chatId, caption, {
      parse_mode: "HTML",
      reply_markup,
    });
    botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
      if (!botInstance) {
        logger.error("Bot instance not initialized in sendWithdraw onReplyToMessage callback");
        return;
      }

      botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
      botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

      if (n_msg.text) {
        if (!isValidAddress(n_msg.text)) {
          await botInstance.sendMessage(chatId, '⚠️ Please input correct wallet address.', {
            parse_mode: "HTML"
          })
          return;
        }
        let result: any;
        if (tokenAddress != "sol") {
          result = await sendSPLtokens(chatId, tokenAddress, n_msg.text, withdrawsetting.amount!, withdrawsetting.isPercentage!)
        }
        else {
          result = await solana.sendNativeSol(chatId, n_msg.text, withdrawsetting.amount!, withdrawsetting.isPercentage!)
        }
        if (result.confirmed) {
          botInstance.sendMessage(chatId, '✅ Successfully withdraw token.', {
            parse_mode: "HTML"
          })
        } else {
          botInstance.sendMessage(chatId, '⚠️ Withdraw is failed. Please try again.', {
            parse_mode: "HTML"
          })
        }
      }
    });
  }
}
