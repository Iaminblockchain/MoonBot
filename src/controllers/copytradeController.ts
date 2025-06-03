import TelegramBot from "node-telegram-bot-api";
import * as walletdb from "../models/walletModel";
import * as copytradedb from "../models/copyTradeModel";
import { botInstance, setState, STATE, removeState, getState } from "../bot";
import { TelegramClient } from "telegram";
import { setAutotradeSignal } from "./autoBuyController";
import mongoose from "mongoose";
import { logger } from "../logger";
import { Trade } from "../models/copyTradeModel";
import { Chat } from "../models/chatModel";
import { getQueue } from "../scraper/queue";
import { notifySuccess, notifyError } from "../notify";

let tgClient: TelegramClient | null = null;

export const setClient = (client: TelegramClient) => {
    tgClient = client;
};

type FieldKey = "tag" | "signal" | "amount" | "slippage" | "rep" | "sl" | "tp" | "limitOrderStep";

interface InputCtx {
    field: FieldKey;
    tradeId: string;
    replaceId: number;
}

export const handleInput = async (msg: TelegramBot.Message, ctx: InputCtx) => {
    const chatId = msg.chat.id.toString();
    const text = (msg.text || "").trim();

    if (!text) return;

    try {
        switch (ctx.field) {
            case "tag":
                await copytradedb.updateTrade({ id: ctx.tradeId, tag: text });
                break;
            case "signal": {
                const { signal, chatId: signalChatId } = await resolveSignalAndChatId(text);
                await copytradedb.updateTrade({
                    id: ctx.tradeId,
                    signal,
                    signalChatId: String(signalChatId),
                });
                break;
            }
            case "amount":
                await copytradedb.updateTrade({ id: ctx.tradeId, amount: +text });
                break;
            case "slippage":
                await copytradedb.updateTrade({ id: ctx.tradeId, maxSlippage: +text });
                break;
            case "rep":
                await copytradedb.updateTrade({ id: ctx.tradeId, repetitiveBuy: +text });
                break;
            case "sl":
                await copytradedb.updateTrade({ id: ctx.tradeId, sl: +text });
                break;
            case "tp":
                await copytradedb.updateTrade({ id: ctx.tradeId, tp: +text });
                break;
            case "limitOrderStep": {
                const [sellPercentage, priceIncrement] = text.split(",").map((num) => parseFloat(num.trim()));

                if (isNaN(sellPercentage) || isNaN(priceIncrement)) {
                    if (!botInstance) return;
                    // Delete instruction and input messages immediately
                    botInstance.deleteMessage(chatId, ctx.replaceId);
                    botInstance.deleteMessage(chatId, msg.message_id);
                    await notifyError(chatId, "Invalid input format. Please use format: sellPercentage,priceIncrement");
                    return;
                }

                const trade = await copytradedb.findTrade({ _id: new mongoose.Types.ObjectId(ctx.tradeId) });
                if (!trade) {
                    logger.error("No Copy Trade signal Error", { tradeId: ctx.tradeId, chatId });
                    return;
                }

                const existingSteps = trade.limitOrderSteps || [];

                // Validate price increment is greater than previous step
                if (existingSteps.length > 0) {
                    const lastStep = existingSteps[existingSteps.length - 1];
                    if (priceIncrement <= lastStep.priceIncrement) {
                        if (!botInstance) return;
                        // Delete instruction and input messages immediately
                        botInstance.deleteMessage(chatId, ctx.replaceId);
                        botInstance.deleteMessage(chatId, msg.message_id);
                        await notifyError(
                            chatId,
                            `Price increment (${priceIncrement}%) must be greater than the previous step (${lastStep.priceIncrement}%)`
                        );
                        return;
                    }
                }

                // Calculate total sell percentage including new step
                const totalSellPercentage = existingSteps.reduce((sum, step) => sum + step.sellPercentage, 0) + sellPercentage;
                if (totalSellPercentage > 100) {
                    if (!botInstance) return;
                    // Delete instruction and input messages immediately
                    botInstance.deleteMessage(chatId, ctx.replaceId);
                    botInstance.deleteMessage(chatId, msg.message_id);
                    await notifyError(
                        chatId,
                        `Total sell percentage (${totalSellPercentage}%) cannot exceed 100%. Current total: ${totalSellPercentage - sellPercentage}%`
                    );
                    return;
                }

                const newStep = {
                    stepNumber: existingSteps.length + 1,
                    sellPercentage,
                    priceIncrement,
                };

                await copytradedb.updateTrade({
                    id: ctx.tradeId,
                    limitOrder: true,
                    limitOrderSteps: [...existingSteps, newStep],
                });

                // Delete the instruction message and user's input
                if (botInstance) {
                    botInstance.deleteMessage(chatId, ctx.replaceId);
                    botInstance.deleteMessage(chatId, msg.message_id);
                }

                await notifySuccess(chatId, "Limit order step added successfully");
                await showLimitOrderSettings(chatId, msg.message_id, ctx.tradeId);
                break;
            }
        }

        // refresh the inline‑keyboard
        if (ctx.field !== "limitOrderStep") {
            await editcopytradesignal(chatId, ctx.replaceId, ctx.tradeId);
        }
    } catch (err) {
        logger.error(err);
        await notifyError(chatId, "Update failed");
    } finally {
        removeState(chatId);
    }
};

export const setAllCopytradeStatus = async (chatId: string, active: boolean) => {
    await Trade.updateMany({ chatId }, { $set: { active } }).exec();
};

const lastMessageId = new Map<string, number>();

// Normalize signal input, ensure chat exists, and return { signal, chatId }.
async function resolveSignalAndChatId(signalInput: string): Promise<{ signal: string; chatId: number | string }> {
    const signal = parseSignalInput(signalInput);
    let chatDoc = await Chat.findOne({ username: signal });
    if (!chatDoc) {
        // Attempt to join the channel
        await getQueue().now("join-channel", { username: signal });
        // Wait for join to take effect, then re-fetch
        chatDoc = await Chat.findOne({ username: signal });
    }
    if (!chatDoc || !chatDoc.chat_id) {
        throw new Error(`Could not resolve chat for signal "${signal}"`);
    }
    return { signal, chatId: chatDoc.chat_id };
}

export const editText = async (chatId: string, text: string, opts: TelegramBot.EditMessageTextOptions = {}): Promise<number> => {
    if (!botInstance) throw new Error("Bot instance not initialized");

    const msgId = opts.message_id ?? lastMessageId.get(chatId);

    try {
        if (msgId) {
            await botInstance.editMessageText(text, {
                chat_id: chatId,
                message_id: msgId,
                ...opts,
            });
            lastMessageId.set(chatId, msgId);
            return msgId;
        }
        throw new Error();
    } catch (_) {
        const { message_id } = await botInstance.sendMessage(chatId, text, opts);
        lastMessageId.set(chatId, message_id);
        return message_id;
    }
};

export const handleCallBackQuery = async (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in handleCallBackQuery");
        return;
    }

    logger.info("copytrade: handleCallBackQuery", { query });

    const { data: callbackData, message: callbackMessage } = query;
    logger.info("copytrade: callbackData", { callbackData });

    if (!callbackData || !callbackMessage) return;
    const chatid = String(callbackMessage.chat.id);
    const msgId = callbackMessage.message_id;

    try {
        if (callbackData === "ct_start") {
            return walletdb.getWalletByChatId(callbackMessage.chat.id).then(async (wallet) => {
                if (!botInstance) {
                    logger.error("Bot instance not initialized in ct_start callback");
                    return;
                }

                if (!wallet) {
                    await botInstance.sendMessage(chatid, "You need to set up your wallet first");
                    return;
                }
                return showPortfolioPad(chatid);
            });
        } else if (callbackData === "ct_add_signal") {
            return walletdb
                .getWalletByChatId(callbackMessage.chat.id)
                .then(async (wallet) => {
                    if (!botInstance) {
                        logger.error("Bot instance not initialized in ct_add_signal callback");
                        return;
                    }

                    if (!wallet) {
                        await botInstance.sendMessage(chatid, "You need to set up your wallet first");
                        return;
                    }
                    const newTrade = await copytradedb.addTrade(chatid);
                    if (newTrade) {
                        return editcopytradesignal(chatid, msgId, String(newTrade._id));
                    }
                })
                .catch((err) => {
                    if (!botInstance) {
                        logger.error("Bot instance not initialized in ct_add_signal error handler");
                        return;
                    }

                    logger.error("wallet lookup failed", err);
                    botInstance.sendMessage(chatid, "❌ Something went wrong.");
                });
        } else if (callbackData === "ct_back") {
            return showPortfolioPad(chatid, msgId);
        } else if (callbackData === "ct_activate_all") {
            await setAllCopytradeStatus(chatid, true);
            await showPortfolioPad(chatid, msgId);
        } else if (callbackData === "ct_deactivate_all") {
            await setAllCopytradeStatus(chatid, false);
            await showPortfolioPad(chatid, msgId);
        } else if (callbackData.startsWith("ct_lim_")) {
            const tradeId = callbackData.replace("ct_lim_", "");
            return showLimitOrderSettings(chatid, msgId, tradeId);
        } else if (callbackData.startsWith("ct_back_to_edit_")) {
            const tradeId = callbackData.replace("ct_back_to_edit_", "");
            return editcopytradesignal(chatid, msgId, tradeId);
        } else if (callbackData.startsWith("ct_set_limit_")) {
            const tradeId = callbackData.replace("ct_set_limit_", "");
            if (!botInstance) return;

            const messageText =
                `<b>Add New Limit Order Step</b>\n\n` +
                `Please enter the sell percentage and price increment in the format:\n` +
                `sellPercentage,priceIncrement\n\n` +
                `Example: 50,100 (sell 50% at 100% price increase)`;

            const reply_markup = {
                force_reply: true,
            };

            const new_msg = await botInstance.sendMessage(chatid, messageText, {
                parse_mode: "HTML",
                reply_markup,
            });

            // Delete the instruction message after 30 seconds if no response
            setTimeout(() => {
                if (botInstance) {
                    botInstance.deleteMessage(chatid, new_msg.message_id);
                }
            }, 30000);

            setState(chatid, STATE.COPYTRADE_INPUT, {
                field: "limitOrderStep",
                tradeId,
                replaceId: new_msg.message_id,
                tempSteps: [],
            });
            return;
        } else if (callbackData.startsWith("ct_reset_steps_")) {
            const tradeId = callbackData.replace("ct_reset_steps_", "");

            await copytradedb.updateTrade({
                id: tradeId,
                limitOrder: false,
                limitOrderActive: false,
                limitOrderSteps: [],
            });

            await notifySuccess(chatid, "Limit order steps have been reset");
            await showLimitOrderSettings(chatid, msgId, tradeId);
            return;
        } else if (callbackData.startsWith("ct_save_steps_")) {
            const tradeId = callbackData.replace("ct_save_steps_", "");
            const currentState = getState(chatid);
            const steps = currentState?.data?.tempSteps || [];

            if (steps.length === 0) {
                if (!botInstance) return;
                await botInstance.answerCallbackQuery(query.id, {
                    text: "Please add at least one step before saving",
                    show_alert: true,
                });
                return;
            }

            // Add step number
            const numberedSteps = steps.map((step: { sellPercentage: number; priceIncrement: number }, index: number) => ({
                ...step,
                stepNumber: index + 1,
            }));

            await copytradedb.updateTrade({
                id: tradeId,
                limitOrder: true,
                limitOrderSteps: numberedSteps,
            });

            await notifySuccess(chatid, "Limit order step saved successfully");
            await showLimitOrderSettings(chatid, msgId, tradeId);
            return;
        } else if (callbackData.startsWith("ct_activate_lim_")) {
            const tradeId = callbackData.replace("ct_activate_lim_", "");
            const trade = await copytradedb.findTrade({ _id: new mongoose.Types.ObjectId(tradeId) });

            if (!trade) {
                logger.error("No Copy Trade signal Error", { tradeId, chatid });
                return;
            }

            const steps = trade.limitOrderSteps || [];

            if (steps.length === 0) {
                if (!botInstance) return;
                await botInstance.answerCallbackQuery(query.id, {
                    text: "Please add at least one step before activating",
                    show_alert: true,
                });
                return;
            }

            // Check if total sell percentage is 100%
            const totalSellPercentage = steps.reduce((sum, step) => sum + step.sellPercentage, 0);
            if (totalSellPercentage !== 100) {
                if (!botInstance) return;
                await botInstance.answerCallbackQuery(query.id, {
                    text: `Total sell percentage must be 100%. Current total: ${totalSellPercentage}%`,
                    show_alert: true,
                });
                return;
            }

            // Check if price increments are strictly increasing
            for (let i = 1; i < steps.length; i++) {
                if (steps[i].priceIncrement <= steps[i - 1].priceIncrement) {
                    if (!botInstance) return;
                    await botInstance.answerCallbackQuery(query.id, {
                        text: `Price increments must be strictly increasing. Check steps ${i} and ${i + 1}`,
                        show_alert: true,
                    });
                    return;
                }
            }

            // Toggle limit order active state
            await copytradedb.updateTrade({
                id: tradeId,
                limitOrderActive: !trade.limitOrderActive,
            });

            await notifySuccess(chatid, trade.limitOrderActive ? "Limit order activated" : "Limit order deactivated");
            await showLimitOrderSettings(chatid, msgId, tradeId);
            return;
        }

        const actionMap: Record<string, Function> = {
            ct_edit: editcopytradesignal,
            ct_del: removecopytradesignal,
            ct_tag: editTagcopytradesignal,
            ct_sig: editSignalcopytradesignal,
            ct_buya: editBuyAmountcopytradesignal,
            ct_sli: editSlippagecopytradesignal,
            ct_rep: editreplicatecopytradesignal,
            ct_stl: editStopLosscopytradesignal,
            ct_tpr: editTakeProfitcopytradesignal,
            ct_act: editActivitycopytradesignal,
        };

        const [prefix, key, value] = callbackData.split("_");
        const fn = actionMap[`${prefix}_${key}`];
        if (fn) {
            return fn(chatid, msgId, value);
        }
    } catch (error) {
        logger.error("callback error", error);
    }
};

const showPortfolioPad = async (chatId: string, replaceId?: number) => {
    const signals = await copytradedb.getTradeByChatId(chatId);
    const wallet = await walletdb.getWalletByChatId(chatId);
    if (!wallet) return;
    const caption = `<b>Copy Trade groups</b>\n\n
This function allows you to monitor any public group or channel on telegram and to buy any token as soon as the contract gets posted in the target group/channel.
You can also customize the buy amount, take profit, stop loss and more for every channel you follow.
🟢 Indicates a copy trade setup is active.
🔴 Indicates a copy trade setup is paused.`;

    const signalKeyboard = signals.map((value: copytradedb.ITrade, index: number) => {
        return [
            {
                text: ` ${value.active ? "🟢" : "🔴"} ${value.signal} : ${value.tag}`,
                command: "ct_edit_" + value.id,
            },
        ];
    });

    const keyboardList = [
        [
            { text: "Activate all", command: "ct_activate_all" },
            { text: "Deactivate all", command: "ct_deactivate_all" },
        ],
        ...signalKeyboard,
        [{ text: "Add Signal", command: "ct_add_signal" }],
        [{ text: "Close", command: "close" }],
    ];

    const reply_markup = {
        inline_keyboard: keyboardList.map((rowItem: { text: string; command: string }[]) =>
            rowItem.map((item) => {
                return {
                    text: item.text,
                    callback_data: item.command,
                };
            })
        ),
    };

    await editText(chatId, caption, {
        parse_mode: "HTML",
        disable_web_page_preview: false,
        reply_markup,
        message_id: replaceId,
    });
};

// strip t.me/ or https://t.me/ and leading/trailing symbols
function parseSignalInput(input: string): string {
    return (
        input
            .trim()
            // strip t.me/ or https://t.me/
            .replace(/^(?:https?:\/\/)?t\.me\//i, "")
            // strip any leading @
            .replace(/^@/, "")
            // strip any trailing slash
            .replace(/\/$/, "")
    );
}

const editcopytradesignal = async (chatId: string, replaceId: number, dbId?: string) => {
    const caption = `<b>HOW TO FOLLOW A GROUP/ CHANNEL</b>
- Assign a unique name or "tag" to your target group/channel, to make it easier to identify.
- Set the target signal channel (https://t.me/abc or @abc) to get signals on the coins they launch.
- Set a specific Buy amount in Sol (for this set up, the bot will always buy specified amount).
- Slippage: Difference between the expected price of a trade and the price at which the trade is executed. (Normally around 5-20% depending on how much volatile the coin is)
- Replicate Buy: Set the number of times to replicate the purchase (How many time the bot should perform the buy if a group or channel calls the coin multiple times, the fastest option is to leave it at one)
- Stop loss: If the coin dumps you can minimize the losses by setting a stop loss. Example: if you set 20, the bot will sell once the coin loses 20% of the value. 
- Take profit: Similar to the stop loss, if the coin you bought gains a specific percentage in value the bot can sell your entire assets for you. 

To manage your Copy Trade:
- Click the "Active" button to pause the Copy Trade.
- Delete a Copy Trade by clicking the "Delete" button`;
    logger.info("editing copytradesignal");
    let trade;
    if (!dbId) {
        logger.error("editcopytradesignal called without dbId", { chatId });
        return;
    }

    trade = await copytradedb.findTrade({ _id: new mongoose.Types.ObjectId(dbId) });
    logger.info(trade);

    if (!trade) {
        logger.error("No Copy Trade signal Error", { dbId: dbId, chatId: chatId });
        return;
    }
    const reply_markup = {
        inline_keyboard: editCopyTradeKeyboard(trade.toObject()).map((rowItem) =>
            rowItem.map((item) => {
                return {
                    text: item.text,
                    callback_data: item.command,
                };
            })
        ),
    };

    await editText(chatId, caption, {
        parse_mode: "HTML",
        disable_web_page_preview: false,
        reply_markup,
    });
};

export const toggleCopytrade = async (chatId: string | number) => {
    const chatIdStr = String(chatId);
    await setAllCopytradeStatus(chatIdStr, true);
};

export const isCopytradeEnabled = async (chatId: string | number): Promise<boolean> => {
    const chatIdStr = String(chatId);
    const trade = await copytradedb.findTrade({ chatId: chatIdStr });
    return trade?.active ?? false;
};

const removecopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {
    const signals = await copytradedb.removeTrade(new mongoose.Types.ObjectId(dbId));
    showPortfolioPad(chatId, replaceId);
};

const editTagcopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in editTagcopytradesignal");
        return;
    }

    const caption = `<b>Please type Your signal Tag name</b>\n\n`;
    const reply_markup = {
        force_reply: true,
    };
    const new_msg = await botInstance.sendMessage(chatId, caption, {
        parse_mode: "HTML",
        reply_markup,
    });
    setState(chatId, STATE.INPUT_COPYTRADE);

    botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: TelegramBot.Message) => {
        if (!botInstance) {
            logger.error("Bot instance not initialized in editTagcopytradesignal callback");
            return;
        }

        botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
        botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

        if (n_msg.text) {
            //TODO  recheck
            await copytradedb.updateTrade({ id: new mongoose.Types.ObjectId(dbId), tag: n_msg.text });
            editcopytradesignal(chatId, replaceId, dbId);
            await notifySuccess(chatId, "Tag updated");
        }
    });
};

const editSignalcopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in editSignalcopytradesignal");
        return;
    }

    const caption = `<b>Please type your signal like "@solsignal" or "https://t.me/solsignal"</b>\n\n`;
    const reply_markup = {
        force_reply: true,
    };
    setState(chatId, STATE.INPUT_COPYTRADE);
    const new_msg = await botInstance.sendMessage(chatId, caption, {
        parse_mode: "HTML",
        reply_markup,
    });
    botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: TelegramBot.Message) => {
        if (!botInstance) {
            logger.error("Bot instance not initialized in editSignalcopytradesignal callback");
            return;
        }

        logger.info("copytrade: onReplyToMessage");
        botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
        botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

        if (n_msg.text) {
            try {
                const { signal, chatId: signalChatId } = await resolveSignalAndChatId(n_msg.text);
                await copytradedb.updateTrade({
                    id: new mongoose.Types.ObjectId(dbId),
                    signal,
                    signalChatId: String(signalChatId),
                });
                await editcopytradesignal(chatId, replaceId, dbId);
                await notifySuccess(chatId, "Group updated");
            } catch (error) {
                logger.error(error);
                await notifyError(chatId, "Failed to update group");
            } finally {
                removeState(chatId);
            }
        }
    });
};

type Spec<T> = {
    label: string;
    dbKey: keyof copytradedb.ITrade;
    parse: (txt: string) => T;
};

const makeEditor =
    <T>(spec: Spec<T>) =>
    async (chatId: string, replaceId: number, dbId: string) => {
        logger.info(`makeEditor called`, {
            label: spec.label,
            dbKey: spec.dbKey,
            chatId,
            replaceId,
            dbId,
        });

        if (!botInstance) {
            logger.error(`Bot instance not initialized in makeEditor for ${spec.label}`);
            return;
        }

        const ask = await botInstance.sendMessage(chatId, `<b>Please type ${spec.label}</b>\n\n`, {
            parse_mode: "HTML",
            reply_markup: { force_reply: true },
        });

        botInstance.onReplyToMessage(ask.chat.id, ask.message_id, async (reply: TelegramBot.Message) => {
            logger.info(`Reply received in makeEditor`, {
                label: spec.label,
                chatId,
                replyText: reply.text,
            });

            if (!botInstance) {
                logger.error(`Bot instance not initialized in makeEditor callback for ${spec.label}`);
                return;
            }

            botInstance.deleteMessage(ask.chat.id, ask.message_id);
            botInstance.deleteMessage(reply.chat.id, reply.message_id);
            if (!reply.text) return;

            try {
                const parsedValue = spec.parse(reply.text);
                logger.info(`Updating trade`, {
                    label: spec.label,
                    dbKey: spec.dbKey,
                    parsedValue,
                    chatId,
                    dbId,
                });

                await copytradedb.updateTrade({
                    id: new mongoose.Types.ObjectId(dbId),
                    [spec.dbKey]: parsedValue,
                });
                await editcopytradesignal(chatId, replaceId, dbId);
            } catch (error: unknown) {
                const errorMessage =
                    error instanceof Error ? error.message : typeof error === "string" ? error : "An unknown error occurred";

                logger.error(`Error in makeEditor`, {
                    label: spec.label,
                    error: errorMessage,
                    chatId,
                    dbId,
                });
                botInstance.sendMessage(chatId, `Error updating ${spec.label}: ${errorMessage}`);
            }
        });
    };

export const editBuyAmountcopytradesignal = makeEditor({ label: "buy amount (SOL)", dbKey: "amount", parse: Number });
export const editSlippagecopytradesignal = makeEditor({ label: "max slippage (%)", dbKey: "maxSlippage", parse: Number });
export const editreplicatecopytradesignal = makeEditor({ label: "replicate count", dbKey: "repetitiveBuy", parse: (n) => parseInt(n, 10) });

export const editStopLosscopytradesignal = makeEditor({
    label: "stop‑loss (%)",
    dbKey: "sl",
    parse: (txt) => {
        const num = parseFloat(txt);
        if (isNaN(num) || num < 0) throw new Error("Invalid stop-loss");
        return num;
    },
});

export const editTakeProfitcopytradesignal = makeEditor({
    label: "take‑profit (%)",
    dbKey: "tp",
    parse: (txt) => {
        const num = parseFloat(txt);
        if (isNaN(num) || num <= 0) throw new Error("Invalid take-profit");
        return num;
    },
});

const editActivitycopytradesignal = async (chatId: string, replaceId: number, dbId: string) => {
    await copytradedb.findAndUpdateOne({ _id: new mongoose.Types.ObjectId(dbId) }, [{ $set: { active: { $not: "$active" } } }]);
    editcopytradesignal(chatId, replaceId, dbId);
};

const editCopyTradeKeyboard = (params: copytradedb.ITrade) => {
    return [
        [{ text: `Tag : ${params.tag == "" ? "-" : params.tag}`, command: `ct_tag_${String(params._id)}` }],
        [{ text: `Signal : ${params.signal == "" ? "-" : `@${params.signal}`}`, command: `ct_sig_${String(params._id)}` }],
        [
            {
                text: `Buy Amount : ${params.amount} SOL`,
                command: `ct_buya_${String(params._id)}`,
            },
        ],
        [
            {
                text: `Slippage : ${params.maxSlippage}%`,
                command: `ct_sli_${String(params._id)}`,
            },
            {
                text: `Replicate Buy : ${params.repetitiveBuy} times`,
                command: `ct_rep_${String(params._id)}`,
            },
        ],
        [
            {
                text: `Stop Loss : ${params.sl == null ? "❌" : params.sl + "%"}`,
                command: `ct_stl_${String(params._id)}`,
            },
            {
                text: `Take Profit : ${params.tp == null ? "❌" : params.tp + "%"}`,
                command: `ct_tpr_${String(params._id)}`,
            },
        ],
        [
            {
                text: `Limit Order ${params.limitOrderActive ? "✅" : ""}`,
                command: `ct_lim_${String(params._id)}`,
            },
        ],
        [
            {
                text: `${params.active ? "🟢 Active" : "🔴 Pause"}`,
                command: `ct_act_${String(params._id)}`,
            },
            {
                text: `Delete`,
                command: `ct_del_${String(params._id)}`,
            },
        ],
        [
            {
                text: `👈 Back`,
                command: `ct_back`,
            },
        ],
    ];
};

export const getAllTrades = async () => {
    try {
        return await Trade.find({}).sort({ _id: -1 });
    } catch (error) {
        logger.error("Error fetching all trades", error);
        return [];
    }
};

export const onSignal = async (chat_id: string, address: string) => {
    try {
        logger.info(`copytrade: onSignal chat ${chat_id}`, { chat: chat_id, address });

        const activeTrades = await Trade.find({ signalChatId: String(chat_id), active: true });
        logger.info(`active signals for signalChatId ${chat_id}: ${activeTrades.length}`);

        if (activeTrades.length === 0) {
            logger.info(`copytrade disabled for signalChatId ${chat_id}`);
            return;
        }

        activeTrades.forEach((trade) => {
            logger.info("copytrade: set auto trade for", { id: trade.chatId, address, tradeId: trade._id });
            setAutotradeSignal(trade.chatId, address, trade);
        });
    } catch (error) {
        logger.error("error onsignal", { chat_id, address });
    }
};

const showLimitOrderSettings = async (chatId: string, replaceId: number, dbId: string) => {
    const trade = await copytradedb.findTrade({ _id: new mongoose.Types.ObjectId(dbId) });
    if (!trade) {
        logger.error("No Copy Trade signal Error", { dbId, chatId });
        return;
    }

    const steps = trade.limitOrderSteps || [];
    const caption =
        `<b>Limit Order Settings</b>\n\n` +
        `Configure your limit order steps. Each step specifies:\n` +
        `- Sell Percentage: How much of your remaining tokens to sell\n` +
        `- Price Increment: At what price increase to trigger the sell\n\n` +
        `Current Steps:\n` +
        (steps.length === 0
            ? "No steps configured"
            : steps
                  .map(
                      (step: { stepNumber: number; sellPercentage: number; priceIncrement: number }) =>
                          `${step.stepNumber}. Sell ${step.sellPercentage}% at ${step.priceIncrement}% price increase`
                  )
                  .join("\n")) +
        `\n\nStatus: ${trade.limitOrderActive ? "🟢 Active" : "🔴 Inactive"}`;

    const keyboard = [
        [
            {
                text: "Add New Step",
                callback_data: `ct_set_limit_${dbId}`,
            },
        ],
        [
            {
                text: "Reset",
                callback_data: `ct_reset_steps_${dbId}`,
            },
        ],
        [
            {
                text: trade.limitOrderActive ? "Unactivate" : "Activate",
                callback_data: `ct_activate_lim_${dbId}`,
            },
        ],
        [
            {
                text: "👈 Back",
                callback_data: `ct_back_to_edit_${dbId}`,
            },
        ],
    ];

    const reply_markup = {
        inline_keyboard: keyboard,
    };

    await editText(chatId, caption, {
        parse_mode: "HTML",
        disable_web_page_preview: false,
        reply_markup,
        message_id: replaceId,
    });
};
