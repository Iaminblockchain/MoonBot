import TelegramBot from "node-telegram-bot-api";
import { botInstance, closeMessage } from "../bot";
import { isValidAddress } from "../solana/util";
import * as buyController from "./buyController";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { SOLANA_CONNECTION } from "..";
import { ITrade } from "../models/copyTradeModel";
import { notifySuccess, notifyError } from "../notify";
import { logger } from "../logger";

// In-memory storage for auto-buy settings per chat.
export interface AutoBuySettings {
    enabled: boolean;
    amount: number; // Either a fixed SOL value or a percentage value
    isPercentage: boolean; // True if the amount is a percentage of the balance
    maxSlippage: number | null; // Slippage percentage
    takeProfit: number | null;
    stopLoss: number | null;
    repetitiveBuy: number;
    limitOrders?: { priceIncreasement: number; sellPercentage: number }[];
}
export const autoBuySettings = new Map<string, AutoBuySettings>();

/**
 * Prompts the user for auto-buy settings: buy amount and maximum slippage.
 */
function promptBuyAmount(chatId: string) {
    if (!botInstance) {
        logger.error("Bot instance not initialized in promptBuyAmount");
        return;
    }

    botInstance
        .sendMessage(chatId, 'Please enter your buy amount (e.g., "1" for 1 SOL or "10%" for 10% of your balance):')
        .then((n_msg: TelegramBot.Message) => {
            if (!botInstance) {
                logger.error("Bot instance not initialized in promptBuyAmount callback");
                return;
            }

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
                    takeProfit: null,
                    stopLoss: null,
                    repetitiveBuy: 1,
                });

                // Now prompt for maximum slippage.
                if (!botInstance) {
                    logger.error("Bot instance not initialized in amountMsg callback");
                    return;
                }

                botInstance
                    .sendMessage(chatId, 'Please enter your maximum slippage (in %, e.g., "1" for 1%):')
                    .then((n1_msg: TelegramBot.Message) => {
                        if (!botInstance) {
                            logger.error("Bot instance not initialized in slippage prompt");
                            return;
                        }

                        botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);
                        botInstance.deleteMessage(amountMsg.chat.id, amountMsg.message_id);

                        botInstance.once("message", (slippageMsg: TelegramBot.Message) => {
                            const slippageValue = parseFloat(slippageMsg.text?.trim() || "0");
                            const settings = autoBuySettings.get(chatId);
                            if (settings) {
                                settings.maxSlippage = slippageValue;
                                autoBuySettings.set(chatId, settings);

                                if (!botInstance) {
                                    logger.error("Bot instance not initialized in slippageMsg callback");
                                    return;
                                }

                                botInstance
                                    .sendMessage(chatId, 'Please enter your take profit (in %, e.g., "1" for 1%):')
                                    .then((n2_msg: TelegramBot.Message) => {
                                        if (!botInstance) {
                                            logger.error("Bot instance not initialized in take profit prompt");
                                            return;
                                        }

                                        botInstance.deleteMessage(n1_msg.chat.id, n1_msg.message_id);
                                        botInstance.deleteMessage(slippageMsg.chat.id, slippageMsg.message_id);

                                        botInstance.once("message", (tpMsg: TelegramBot.Message) => {
                                            const tpValue = parseFloat(tpMsg.text?.trim() || "0");
                                            const settings = autoBuySettings.get(chatId);
                                            if (settings) {
                                                settings.takeProfit = tpValue;
                                                autoBuySettings.set(chatId, settings);

                                                if (!botInstance) {
                                                    logger.error("Bot instance not initialized in tpMsg callback");
                                                    return;
                                                }

                                                const answer2 = botInstance
                                                    .sendMessage(chatId, `Please enter your Stop loss percentage (e.g. "1" for 1%)`)
                                                    .then((n3_msg: TelegramBot.Message) => {
                                                        if (!botInstance) {
                                                            logger.error("Bot instance not initialized in stop loss prompt");
                                                            return;
                                                        }

                                                        botInstance.deleteMessage(n2_msg.chat.id, n2_msg.message_id);
                                                        botInstance.deleteMessage(tpMsg.chat.id, tpMsg.message_id);

                                                        botInstance.once("message", (stoplossMsg: TelegramBot.Message) => {
                                                            const stoploss = parseInt(stoplossMsg.text?.trim() || "0");
                                                            const settings = autoBuySettings.get(chatId);
                                                            if (settings) {
                                                                settings.stopLoss = stoploss;
                                                                autoBuySettings.set(chatId, settings);

                                                                if (!botInstance) {
                                                                    logger.error("Bot instance not initialized in stoplossMsg callback");
                                                                    return;
                                                                }

                                                                botInstance
                                                                    .sendMessage(
                                                                        chatId,
                                                                        `Please enter your repetitive buys number (e.g. "1" The minimum value is 1)`
                                                                    )
                                                                    .then((n4_msg: TelegramBot.Message) => {
                                                                        if (!botInstance) {
                                                                            logger.error(
                                                                                "Bot instance not initialized in repetitive buys prompt"
                                                                            );
                                                                            return;
                                                                        }

                                                                        botInstance.deleteMessage(n3_msg.chat.id, n3_msg.message_id);
                                                                        botInstance.deleteMessage(
                                                                            stoplossMsg.chat.id,
                                                                            stoplossMsg.message_id
                                                                        );
                                                                        botInstance.once("message", (duplicateMsg: TelegramBot.Message) => {
                                                                            const duplicate = parseInt(duplicateMsg.text?.trim() || "0");
                                                                            const settings = autoBuySettings.get(chatId);
                                                                            if (settings) {
                                                                                settings.repetitiveBuy = duplicate;
                                                                                autoBuySettings.set(chatId, settings);

                                                                                if (!botInstance) {
                                                                                    logger.error(
                                                                                        "Bot instance not initialized in duplicateMsg callback"
                                                                                    );
                                                                                    return;
                                                                                }

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
                                                                                            inline_keyboard: showCopyTradeKeyboard(
                                                                                                settings
                                                                                            ).map((rowItem) =>
                                                                                                rowItem.map((item) => {
                                                                                                    return {
                                                                                                        text: item.text,
                                                                                                        callback_data: item.command,
                                                                                                    };
                                                                                                })
                                                                                            ),
                                                                                        },
                                                                                    }
                                                                                );
                                                                            }
                                                                        });
                                                                    });
                                                            }
                                                        });
                                                    });
                                            }
                                        });
                                    });
                            }
                        });
                    })
                    .catch((err: Error) => logger.error("Error sending slippage prompt:", err));
            });
        })
        .catch((err: Error) => logger.error("Error sending buy amount prompt:", err));
}

/**
 * Handles the /autobuy command (text-based).
 */
export const onAutoBuyCommand = (msg: TelegramBot.Message) => {
    promptBuyAmount(String(msg.chat.id));
};

/**
 * Handles callback queries related to auto-buy.
 */
export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in handleCallBackQuery");
        return;
    }

    if (query.data === "autoBuyController_start") {
        const rawChatId = query.message?.chat?.id;
        if (rawChatId !== undefined) {
            const chatId = String(rawChatId);
            botInstance.answerCallbackQuery(query.id);
            logger.info("autoBuySettings", { autoBuySettings: autoBuySettings.get(chatId) });
            const settings = autoBuySettings.get(chatId);
            if (
                !settings ||
                !settings.enabled ||
                !settings.amount ||
                settings.maxSlippage === null ||
                settings.takeProfit === undefined ||
                settings.stopLoss === undefined ||
                settings.repetitiveBuy < 1
            ) {
                promptBuyAmount(chatId);
            } else {
                botInstance.sendMessage(chatId, `🟢 Auto-buy is enabled with settings:\n`, {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: showCopyTradeKeyboard(settings).map((rowItem) =>
                            rowItem.map((item) => {
                                return {
                                    text: item.text,
                                    callback_data: item.command,
                                };
                            })
                        ),
                    },
                });
            }
        }
    } else if (query.data === "autoBuyController_delete_settings") {
        const rawChatId = query.message?.chat?.id;
        if (rawChatId !== undefined) {
            const chatId = String(rawChatId);
            autoBuySettings.delete(chatId);
            closeMessage(query);
            botInstance.answerCallbackQuery(query.id, {
                text: "Auto-buy settings deleted.",
            });
            botInstance.sendMessage(chatId, "Auto-buy settings deleted.");
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
    const chatId = String(msg.chat.id);
    const contractAddress = msg.text || "";
    const settings = autoBuySettings.get(chatId) as AutoBuySettings | undefined;

    if (settings) {
        triggerAutoBuy(chatId, contractAddress, settings);
    }
}

export const setAutotradeSignal = async (chatId: string, contractAddress: string, trade?: ITrade): Promise<void> => {
    if (!isValidAddress(contractAddress) || !trade) {
        logger.error("Invalid contract address or missing trade", { contractAddress, trade });
        return;
    }

    // TODO: make this dynamic
    const settings: AutoBuySettings = {
        enabled: trade.active,
        amount: trade.amount,
        isPercentage: false,
        maxSlippage: trade.maxSlippage,
        takeProfit: trade.tp,
        stopLoss: trade.sl,
        repetitiveBuy: trade.repetitiveBuy,
        limitOrders: trade.limitOrderSteps?.map(step => ({
            priceIncreasement: step.priceIncrement,
            sellPercentage: step.sellPercentage
        }))
    };

    triggerAutoBuy(chatId, contractAddress, settings, trade.signal);
};

function triggerAutoBuy(chatId: string, contractAddress: string, settings: AutoBuySettings, signal?: string) {
    const { enabled, amount, isPercentage, maxSlippage, takeProfit, stopLoss, repetitiveBuy } = settings;

    if (!enabled) {
        logger.error("Auto-buy not enabled", { chatId });
        return;
    }

    if (!amount || amount <= 0) {
        notifyError(chatId, "Autobuy: Amount missing or zero").catch((err) => logger.error("Failed to notify user", { chatId, err }));
        logger.error("Amount missing or zero", { chatId });
        return;
    }

    if (maxSlippage === null || maxSlippage === undefined) {
        notifyError(chatId, "Max slippage not set").catch((err) => logger.error("Failed to notify user", { chatId, err }));
        logger.error("Max slippage not set", { chatId });
        return;
    }

    if (takeProfit != null && takeProfit <= 0) {
        notifyError(chatId, "TakeProfit must be greater than 0").catch((err) => logger.error("Failed to notify user", { chatId, err }));
        logger.error("TakeProfit must be greater than 0", { chatId });
        return;
    }

    if (stopLoss != null && stopLoss <= 0) {
        notifyError(chatId, "StopLoss must be greater than 0").catch((err) => logger.error("Failed to notify user", { chatId, err }));
        logger.error("StopLoss must be greater than 0", { chatId });
        return;
    }

    // Enhanced logging for autobuy trigger
    logger.info(`AUTOBUY Trigger Settings:`, {
        signal: signal || "Manual",
        chatId,
        contractAddress,
        settings: {
            amount: `${amount}${isPercentage ? "%" : " SOL"}`,
            maxSlippage: `${maxSlippage}%`,
            takeProfit: takeProfit ? `${takeProfit}%` : "Not set",
            stopLoss: stopLoss ? `${stopLoss}%` : "Not set",
            repetitiveBuy: `${repetitiveBuy} times`,
        },
    });

    buyController.autoBuyContract(
        chatId,
        {
            enabled,
            amount,
            isPercentage,
            maxSlippage,
            takeProfit,
            stopLoss,
            repetitiveBuy,
            limitOrders: settings.limitOrders
        },
        contractAddress,
        signal
    );
}

/**
 * (Optional) Allow external modules to update auto-buy settings.
 */
export function setAutoBuySettings(chatId: string, settings: AutoBuySettings) {
    autoBuySettings.set(chatId, settings);
}

export const getSPLBalance = async (mint: string, owner: string): Promise<number> => {
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
    } catch (error: unknown) {
        logger.error("Error getting SPL token balance", {
            error: error instanceof Error ? error.message : String(error),
            mint,
            owner,
        });
        tokenBalance = 0;
    }
    return tokenBalance;
};

const showCopyTradeKeyboard = (params: AutoBuySettings) => {
    return [
        [
            {
                text: `Amount : ${params.isPercentage ? `${params.amount}%` : `${params.amount}SOL`}`,
                command: `dismiss`,
            },
        ],
        [{ text: `Max Slippage : ${params.maxSlippage}%`, command: `dismiss` }],
        [{ text: `Take Profit : ${params.takeProfit}%`, command: `dismiss` }],
        [{ text: `Stop Loss : ${params.stopLoss}%`, command: `dismiss` }],
        [{ text: `Repetitive Buy : ${params.repetitiveBuy} times`, command: `dismiss` }],
        [
            {
                text: `Delete settings`,
                command: `autoBuyController_delete_settings`,
            },
        ],
        [
            {
                text: `Close`,
                command: `close`,
            },
        ],
    ];
};
