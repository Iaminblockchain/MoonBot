import TelegramBot from "node-telegram-bot-api";
import { botInstance } from "../bot";
import { isValidAddress } from "../solana";
import * as buyController from "./buyController";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { SOLANA_CONNECTION } from "..";
import { findTrade } from "../models/copyTradeModel";

// In-memory storage for auto-buy settings per chat.
export interface AutoBuySettings {
  enabled: boolean;
  amount: number; // Either a fixed SOL value or a percentage value
  isPercentage: boolean; // True if the amount is a percentage of the balance
  maxSlippage: number | null; // Slippage percentage
  takeProfit: number;
  stopLoss: number;
  repetitiveBuy: number;
}
export const autoBuySettings = new Map<number, AutoBuySettings>();

/**
 * Prompts the user for auto-buy settings: buy amount and maximum slippage.
 */
function promptBuyAmount(chatId: number) {
  botInstance
    .sendMessage(
      chatId,
      'Please enter your buy amount (e.g., "1" for 1 SOL or "10%" for 10% of your balance):'
    )
    .then((n_msg: any) => {
      botInstance.once("message", (amountMsg: TelegramBot.Message) => {
        const amountText = amountMsg.text || "";
        const isPercentage = amountText.trim().endsWith("%");
        const amountValue = parseFloat(amountText.trim().replace("%", ""));
        // Save initial settings.
        autoBuySettings.set(chatId, {
          enabled: true,
          amount: amountValue,
          isPercentage,
          maxSlippage: null,
          takeProfit: 0,
          stopLoss: 0,
          repetitiveBuy: 1,
        });
        // Now prompt for maximum slippage.
        botInstance
          .sendMessage(
            chatId,
            'Please enter your maximum slippage (in %, e.g., "1" for 1%):'
          )
          .then((n1_msg: any) => {
            botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);
            botInstance.deleteMessage(amountMsg.chat.id, amountMsg.message_id);

            botInstance.once("message", (slippageMsg: TelegramBot.Message) => {
              const slippageValue = parseFloat(slippageMsg.text?.trim() || "0");
              const settings = autoBuySettings.get(chatId);
              if (settings) {
                settings.maxSlippage = slippageValue;
                autoBuySettings.set(chatId, settings);
                botInstance
                  .sendMessage(
                    chatId,
                    'Please enter your take profit (in %, e.g., "1" for 1%):'
                  )
                  .then((n2_msg: any) => {
                    botInstance.deleteMessage(
                      n1_msg.chat.id,
                      n1_msg.message_id
                    );
                    botInstance.deleteMessage(
                      slippageMsg.chat.id,
                      slippageMsg.message_id
                    );

                    botInstance.once(
                      "message",
                      (tpMsg: TelegramBot.Message) => {
                        const tpValue = parseFloat(tpMsg.text?.trim() || "0");
                        const settings = autoBuySettings.get(chatId);
                        if (settings) {
                          settings.takeProfit = tpValue;
                          autoBuySettings.set(chatId, settings);
                          const answer2 = botInstance
                            .sendMessage(
                              chatId,
                              `Please enter your Stop loss percentage (e.g. "1" for 1%)`
                            )
                            .then((n3_msg: any) => {
                              botInstance.deleteMessage(
                                n2_msg.chat.id,
                                n2_msg.message_id
                              );
                              botInstance.deleteMessage(
                                tpMsg.chat.id,
                                tpMsg.message_id
                              );

                              botInstance.once(
                                "message",
                                (stoplossMsg: TelegramBot.Message) => {
                                  const stoploss = parseInt(
                                    stoplossMsg.text?.trim() || "0"
                                  );
                                  const settings = autoBuySettings.get(chatId);
                                  if (settings) {
                                    settings.stopLoss = stoploss;
                                    autoBuySettings.set(chatId, settings);
                                    botInstance
                                      .sendMessage(
                                        chatId,
                                        `Please enter your repetitive buys number (e.g. "1" The minimum value is 1)`
                                      )
                                      .then((n4_msg: any) => {
                                        botInstance.deleteMessage(
                                          n3_msg.chat.id,
                                          n3_msg.message_id
                                        );
                                        botInstance.deleteMessage(
                                          stoplossMsg.chat.id,
                                          stoplossMsg.message_id
                                        );
                                        botInstance.once(
                                          "message",
                                          (duplicateMsg: TelegramBot.Message) => {
                                            const duplicate = parseInt(
                                              duplicateMsg.text?.trim() || "0"
                                            );
                                            const settings =
                                              autoBuySettings.get(chatId);
                                            if (settings) {
                                              settings.repetitiveBuy =
                                                duplicate;
                                              autoBuySettings.set(
                                                chatId,
                                                settings
                                              );
                                              botInstance.deleteMessage(
                                                n4_msg.chat.id,
                                                n4_msg.message_id
                                              );
                                              botInstance.deleteMessage(
                                                duplicateMsg.chat.id,
                                                duplicateMsg.message_id
                                              );
                                              botInstance.sendMessage(
                                                chatId,
                                                `🟢 Auto-buy enabled with settings:\n`,
                                                {
                                                  parse_mode: "HTML",
                                                  reply_markup: {
                                                    inline_keyboard: showCopyTradeKeyboard(settings).map((rowItem) =>
                                                      rowItem.map((item) => {
                                                        return {
                                                          text: item.text,
                                                          callback_data: item.command,
                                                        };
                                                      })
                                                    )
                                                  }
                                                }
                                              );
                                            }
                                          }
                                        );
                                      });
                                  }
                                }
                              );
                            });
                        }
                      }
                    );
                  });
              }
            });
          })
          .catch((err: any) =>
            console.error("Error sending slippage prompt:", err)
          );
      });
    })
    .catch((err: any) =>
      console.error("Error sending buy amount prompt:", err)
    );
}

/**
 * Handles the /autobuy command (text-based).
 */
export const onAutoBuyCommand = (msg: TelegramBot.Message) => {
  promptBuyAmount(msg.chat.id);
};

/**
 * Handles callback queries related to auto-buy.
 */
export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
  if (query.data === "autoBuyController_start") {
    const chatId = query.message?.chat.id;
    if (chatId) {
      botInstance.answerCallbackQuery(query.id);
      promptBuyAmount(chatId);
    }
  } else {
    botInstance.answerCallbackQuery(query.id, {
      text: "Unknown auto-buy action",
    });
  }
};

/**
 * Checks if the message contains a valid contract address and, if auto-buy is enabled,
 * triggers a purchase using the auto-buy settings.
 */
export function checkAutoBuy(msg: TelegramBot.Message) {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  // Only process if text is a valid contract address.
  setAutotrade(chatId, text);
}

export const setAutotrade = async (
  chatId: number,
  contractAddress: string,
  channel?: string
) => {

  if (!isValidAddress(contractAddress)) return;
  let settings: any;
  if (channel) {
    settings = await findTrade({ chatId, signal: channel });
  } else {
    settings = autoBuySettings.get(chatId);
  }
  console.log("settings", settings, chatId, channel)
  if (
    settings &&
    settings.active &&
    settings.amount &&
    settings.maxSlippage !== null
  ) {
    console.log(
      `Auto-buy triggered for chat ${chatId} with contract ${contractAddress}`
    );
    // Create a new settings object with maxSlippage asserted as non-null.
    if (channel) {
      buyController.autoBuyContract(
        chatId,
        {
          amount: settings.amount,
          isPercentage: false,
          maxSlippage: settings.maxSlippage!,
          takeProfit: settings.tp,
          stopLoss: settings.sl,
          repetitiveBuy: settings.repetitiveBuy,
        },
        contractAddress
      );
    } else {
      buyController.autoBuyContract(
        chatId,
        {
          amount: settings.amount,
          isPercentage: false,
          maxSlippage: settings.maxSlippage!,
          takeProfit: settings.takeProfit,
          stopLoss: settings.stopLoss,
          repetitiveBuy: settings.repetitiveBuy,
        },
        contractAddress
      );
    }
  }
}

/**
 * (Optional) Allow external modules to update auto-buy settings.
 */
export function setAutoBuySettings(chatId: number, settings: AutoBuySettings) {
  autoBuySettings.set(chatId, settings);
}

export const getPrice = async (mint: string) => {
  try {
    const response = await fetch(
      `https://api.jup.ag/price/v2?ids=${mint}&showExtraInfo=true`
    );
    const res = await response.json();
    const price = res.data[mint].price;
    return Number(price);
  } catch (e) {
    console.log("Get Price", e);
    return 0;
  }
};

export const getSPLBalance = async (mint: string, owner: string) => {
  let tokenBalance = 0;
  try {
    const mintinfo = await SOLANA_CONNECTION.getAccountInfo(
      new PublicKey(mint)
    );
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(mint),
      new PublicKey(owner),
      true,
      mintinfo?.owner,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const balance = await SOLANA_CONNECTION.getTokenAccountBalance(ata);
    if (balance.value.uiAmount) {
      tokenBalance = parseInt(balance.value.amount);
    }
  } catch (e) {
    tokenBalance = 0;
  }
  return tokenBalance;
};

const showCopyTradeKeyboard = (params: AutoBuySettings) => {
  return [
    [
      {
        text: `Amount : ${params.isPercentage ? `${params.amount}%` : `${params.amount}SOL`
          }`,
        command: `dismiss`,
      },
    ],
    [{ text: `Max Slippage : ${params.maxSlippage}%`, command: `dismiss` }],
    [{ text: `Take Profit : ${params.takeProfit}%`, command: `dismiss` }],
    [{ text: `Stop Loss : ${params.stopLoss}%`, command: `dismiss` }],
    [{ text: `Repetitive Buy : ${params.repetitiveBuy} times`, command: `dismiss` }],

    [
      {
        text: `Close`,
        command: `close`,
      },
    ],
  ];
};
