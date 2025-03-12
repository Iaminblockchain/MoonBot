import TelegramBot from 'node-telegram-bot-api';
import { botInstance } from '../bot';
import { isValidAddress } from '../solana';
import * as buyController from './buyController';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { SOLANA_CONNECTION } from '../config';

// In-memory storage for auto-buy settings per chat.
export interface AutoBuySettings {
  enabled: boolean;
  amount: number;       // Either a fixed SOL value or a percentage value
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
  botInstance.sendMessage(
    chatId,
    'Please enter your buy amount (e.g., "1" for 1 SOL or "10%" for 10% of your balance):'
  )
    .then(() => {
      botInstance.once('message', (amountMsg: TelegramBot.Message) => {
        const amountText = amountMsg.text || '';
        const isPercentage = amountText.trim().endsWith('%');
        const amountValue = parseFloat(amountText.trim().replace('%', ''));
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
        botInstance.sendMessage(
          chatId,
          'Please enter your maximum slippage (in %, e.g., "1" for 1%):'
        )
          .then(() => {
            botInstance.once('message', (slippageMsg: TelegramBot.Message) => {
              const slippageValue = parseFloat(slippageMsg.text?.trim() || '0');
              const settings = autoBuySettings.get(chatId);
              if (settings) {
                settings.maxSlippage = slippageValue;
                autoBuySettings.set(chatId, settings);
                botInstance.sendMessage(
                  chatId,
                  'Please enter your take profit (in %, e.g., "1" for 1%):'
                )
                  .then(() => {
                    botInstance.once('message', (tpMsg: TelegramBot.Message) => {
                      const tpValue = parseFloat(tpMsg.text?.trim() || '0');
                      const settings = autoBuySettings.get(chatId);
                      if (settings) {
                        settings.takeProfit = tpValue;
                        autoBuySettings.set(chatId, settings);
                        botInstance.sendMessage(
                          chatId,
                          `Please enter your Stop loss percentage (e.g. "1" for 1%)`
                        ).then(() => {
                          botInstance.once('message', (tpMsg: TelegramBot.Message) => {
                            const stoploss = parseInt(tpMsg.text?.trim() || '0');
                            const settings = autoBuySettings.get(chatId);
                            if (settings) {
                              settings.stopLoss = stoploss;
                              autoBuySettings.set(chatId, settings);
                              botInstance.sendMessage(
                                chatId,
                                `Please enter your repetitive buys number (e.g. "1" The minimum value is 1)`
                              ).then(() => {
                                botInstance.once('message', (tpMsg: TelegramBot.Message) => {
                                  const duplicate = parseInt(tpMsg.text?.trim() || '0');
                                  const settings = autoBuySettings.get(chatId);
                                  if (settings) {
                                    settings.repetitiveBuy = duplicate;
                                    autoBuySettings.set(chatId, settings);
                                    botInstance.sendMessage(
                                      chatId,
                                      `Auto-buy enabled with settings:\n${JSON.stringify(settings, null, 2)}`
                                    );
                                  }
                                });
                              })
                            }
                          });
                        })
                      }
                    });
                  })
              }
            });
          })
          .catch(err => console.error('Error sending slippage prompt:', err));
      });
    })
    .catch(err => console.error('Error sending buy amount prompt:', err));
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
  if (query.data === 'autoBuyController_start') {
    const chatId = query.message?.chat.id;
    if (chatId) {
      botInstance.answerCallbackQuery(query.id);
      promptBuyAmount(chatId);
    }
  } else {
    botInstance.answerCallbackQuery(query.id, { text: 'Unknown auto-buy action' });
  }
};

/**
 * Checks if the message contains a valid contract address and, if auto-buy is enabled,
 * triggers a purchase using the auto-buy settings.
 */
export function checkAutoBuy(msg: TelegramBot.Message) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  // Only process if text is a valid contract address.
  setAutotrade(chatId, text);
}

export function setAutotrade(chatId: number, contractAddress: string) {
  if (!isValidAddress(contractAddress)) return;

  const settings = autoBuySettings.get(chatId);
  if (settings && settings.enabled && settings.amount && settings.maxSlippage !== null) {
    console.log(`Auto-buy triggered for chat ${chatId} with contract ${contractAddress}`);
    // Create a new settings object with maxSlippage asserted as non-null.

    buyController.autoBuyContract(chatId, {
      amount: settings.amount,
      isPercentage: settings.isPercentage,
      maxSlippage: settings.maxSlippage!,
      takeProfit: settings.takeProfit,
      stopLoss: settings.stopLoss,
      repetitiveBuy: settings.repetitiveBuy
    }, contractAddress);
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
    console.log("Get Price", e)
    return 0;
  }
};

export const getSPLBalance = async (mint: string, owner: string) => {
  let tokenBalance = 0;
  try {
    const mintinfo = await SOLANA_CONNECTION.getAccountInfo(new PublicKey(mint));
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
}

export const onGetSignal = async (msg: TelegramBot.Message) => {
  const messageText = msg.text?.trim();
  // messageText style : /getsignal 33303 8CiH3cj4GgSfv3V84jxo1ZcnHCnpKpTvWz6HECdrpump
  botInstance.deleteMessage(msg.chat.id, msg.message_id);
  const data = messageText?.split(' ');
  if (!data || data.length !== 3) return;
  setAutotrade(parseInt(data[1]), data[2])
}