import TelegramBot from "node-telegram-bot-api";
import { botInstance } from "../bot";
import { getWalletByChatId } from "../models/walletModel";
import { getPublicKeyinFormat } from "./sellController";
import { getAllTokensWithBalance } from "../solana/trade";
import { getTokenInfofromMint, getTokenMetaData } from "../solana/token";
import { logger } from "../logger";
import { SOLANA_CONNECTION } from "..";
import { PublicKey } from "@solana/web3.js";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in positionController.handleCallBackQuery");
        return;
    }

    try {
        const { data: callbackData, message: callbackMessage } = query;
        if (!callbackData || !callbackMessage) return;
        let callback_str = String(callbackMessage.chat.id);

        if (callbackData === "pos_start") {
            showPositionMenu(callback_str);
        } else if (callbackData === "pos_open") {
            showOpenPositions(callback_str, callbackMessage.message_id);
        } else if (callbackData === "pos_closed") {
            showClosedPositions(callback_str, callbackMessage.message_id);
        } else if (callbackData.startsWith("pos_token_")) {
            const tokenAddress = callbackData.split("_")[2];
            showTokenInfo(callback_str, callbackMessage.message_id, tokenAddress);
        } else if (callbackData === "pos_back") {
            showPositionMenu(callback_str, callbackMessage.message_id);
        }
    } catch (error) {
        logger.error("Error in positionController.handleCallBackQuery", { error });
    }
};

const showPositionMenu = async (chatId: string, replaceId?: number) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in showPositionMenu");
        return;
    }

    const title = "📊 <b>Position management</b>\n\nYou can manage and check your open and closed positions here.";
    const buttons = [
        [
            { text: "Open Positions", callback_data: "pos_open" },
            { text: "Closed Positions", callback_data: "pos_closed" }
        ],
        [{ text: "Close", callback_data: "close" }]
    ];

    if (replaceId) {
        await botInstance.editMessageText(title, {
            chat_id: chatId,
            message_id: replaceId,
            reply_markup: { inline_keyboard: buttons },
            parse_mode: "HTML"
        });
    } else {
        await botInstance.sendMessage(chatId, title, {
            reply_markup: { inline_keyboard: buttons },
            parse_mode: "HTML"
        });
    }
};

const showOpenPositions = async (chatId: string, replaceId: number) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in showOpenPositions");
        return;
    }

    try {
        const wallet = await getWalletByChatId(chatId);
        if (!wallet) {
            await botInstance.editMessageText("❌ No wallet found. Please connect a wallet first.", {
                chat_id: chatId,
                message_id: replaceId
            });
            return;
        }

        const publicKey = getPublicKeyinFormat(wallet.privateKey);
        const tokens = await getAllTokensWithBalance(SOLANA_CONNECTION, new PublicKey(publicKey));

        if (tokens.length === 0) {
            await botInstance.editMessageText("No open positions found.", {
                chat_id: chatId,
                message_id: replaceId,
                reply_markup: {
                    inline_keyboard: [[{ text: "Back", callback_data: "pos_back" }]]
                }
            });
            return;
        }

        const buttons = tokens.map(token => [
            { text: token.symbol, callback_data: `pos_token_${token.address}` }
        ]);
        buttons.push([{ text: "Back", callback_data: "pos_back" }]);

        await botInstance.editMessageText("Open Positions:", {
            chat_id: chatId,
            message_id: replaceId,
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (error) {
        logger.error("Error in showOpenPositions", { error });
        await botInstance.editMessageText("❌ Error fetching positions", {
            chat_id: chatId,
            message_id: replaceId
        });
    }
};

const showClosedPositions = async (chatId: string, replaceId: number) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in showClosedPositions");
        return;
    }

    // TODO: Implement closed positions logic
    await botInstance.editMessageText("Closed positions will be shown here", {
        chat_id: chatId,
        message_id: replaceId,
        reply_markup: {
            inline_keyboard: [[{ text: "Back", callback_data: "pos_back" }]]
        }
    });
};

const showTokenInfo = async (chatId: string, replaceId: number, tokenAddress: string) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in showTokenInfo");
        return;
    }

    try {
        const tokenMetaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
        if (!tokenMetaData) {
            throw new Error("Token metadata not found");
        }

        const message = `Token Information:\n\n` +
            `Symbol: ${tokenMetaData.symbol}\n` +
            `Name: ${tokenMetaData.name}\n` +
            `Address: ${tokenAddress}\n` +
            `Decimals: ${tokenMetaData.decimals}`;

        await botInstance.editMessageText(message, {
            chat_id: chatId,
            message_id: replaceId,
            reply_markup: {
                inline_keyboard: [[{ text: "Back", callback_data: "pos_open" }]]
            }
        });
    } catch (error) {
        logger.error("Error in showTokenInfo", { error });
        await botInstance.editMessageText("❌ Error fetching token information", {
            chat_id: chatId,
            message_id: replaceId
        });
    }
}; 