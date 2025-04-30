import TelegramBot from "node-telegram-bot-api";
import { botInstance } from "../bot";
import { getWalletByChatId } from "../models/walletModel";
import { getPublicKeyinFormat } from "./sellController";
import { SOLANA_CONNECTION } from "..";
import { getAllTokensWithBalance, jupiter_swap, swapToken, WSOL_ADDRESS } from "../solana/trade";
import { getTokenInfofromMint, getTokenMetaData } from "../solana/token";
import { getPrice } from "./autoBuyController";
import { logger } from "../logger";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in portfolioController.handleCallBackQuery");
        return;
    }

    try {
        const { data: callbackData, message: callbackMessage } = query;
        if (!callbackData || !callbackMessage) return;
        let callback_str = String(callbackMessage.chat.id);
        if (callbackData == "pC_start") {
            showPortfolioStart(callback_str);
        } else if (callbackData.startsWith("pC_show_")) {
            const token = callbackData.split('_');
            portfolioPad(callback_str, callbackMessage.message_id, token[2]);
        } else if (callbackData.startsWith("pC_sell_")) {
            const token = callbackData.split('_');
            sellPortfolio(callback_str, callbackMessage.message_id, token[2], token[3]);
        } else if (callbackData == "pC_back") {
            showPortfolioStart(callback_str, callbackMessage.message_id);
        }
    } catch (error) {
        logger.error("Error in portfolioController.handleCallBackQuery", { error });
    }
}

const showPortfolioStart = async (chatId: string, replaceId?: number) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in showPortfolioStart");
        return;
    }

    try {
        const wallet = await getWalletByChatId(chatId);
        if (!wallet) {
            botInstance.sendMessage(chatId, "❌ No wallet found. Please connect a wallet first.");
            return;
        }
        const publicKey = getPublicKeyinFormat(wallet.privateKey);

        // Fetch all tokens in the wallet
        const tokenAccounts = await getAllTokensWithBalance(SOLANA_CONNECTION, publicKey);

        if (!tokenAccounts || tokenAccounts.length === 0) {
            botInstance.sendMessage(chatId, "⚠️ No tokens found in your wallet.");
            return;
        }
        let tokenList = ''
        // Generate buttons for each token
        tokenAccounts.forEach((token, index) => [
            tokenList += `${index + 1} : ${token.name}(${token.symbol}): ${token.balance} ${token.symbol}\n`
        ]);

        const caption = "<b>Select a token to check assets\n\n</b>" + tokenList;

        const Keyboard = tokenAccounts.map((token, index) => {
            return [
                {
                    text: `${index + 1}: ${token.name}(${token.symbol})`,
                    command: `pC_show_${token.address}`,
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
    } catch (e) {
        logger.error("portfolioStart Error", e);
    }
}

const portfolioPad = async (chatId: string, replaceId: number, tokenAddress: string) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in portfolioPad");
        return;
    }

    try {
        const wallet = await getWalletByChatId(chatId);
        if (!wallet) {
            botInstance.sendMessage(chatId, "❌ No wallet found. Please connect a wallet first.");
            return;
        }
        const publicKey = getPublicKeyinFormat(wallet.privateKey);
        const tokenInfo = await getTokenInfofromMint(publicKey, tokenAddress)
        const metaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
        const price = await getPrice(tokenAddress);
        const caption = `<b>Portfolio ${metaData?.name}(${metaData?.symbol})\n\n</b>
  Balance: ${tokenInfo?.uiAmount} ${metaData?.symbol}
  Price: $${price}
  Total Supply: ${metaData?.totalSupply} ${metaData?.symbol}
  Market Cap: $${price * (metaData?.totalSupply ?? 0)}`;

        const keyboard = (tokenContractAddress: string) => [[{
            text: `${"Sell 50 %"}`,
            command: `pC_sell_50_${tokenContractAddress}`,
        }, {
            text: `${"Sell 100 %"}`,
            command: `pC_sell_100_${tokenContractAddress}`,
        }, {
            text: `${"Sell X %"}`,
            command: `pC_sell_x_${tokenContractAddress}`,
        },], [
            {
                text: `👈 Back`,
                command: `pC_back`,
            },
        ]
        ];

        const reply_markup = {
            inline_keyboard: keyboard(tokenAddress).map((rowItem) =>
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
        logger.error("PortfolioPad Error", e);
    }
}

const sellPortfolio = async (chatId: string, replaceId: number, amount: string, tokenAddress: string) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in sellPortfolio");
        return;
    }

    try {
        const wallet = await getWalletByChatId(chatId);
        if (!wallet) {
            botInstance.sendMessage(chatId, "❌ No wallet found. Please connect a wallet first.");
            return;
        }
        const publicKey = getPublicKeyinFormat(wallet.privateKey);
        const tokenInfo = await getTokenInfofromMint(publicKey, tokenAddress)
        if (!tokenInfo) {
            logger.error("No Token Balance Error");
            logger.info("Wallet Address", { publicKey: publicKey.toBase58() });
            logger.info("Token Address", { tokenAddress: tokenAddress });
            return;
        }
        const metaData = await getTokenMetaData(SOLANA_CONNECTION, tokenAddress);
        if (amount == 'x') {
            const caption = `<b>Please type token amount to sell</b>\n\n`;
            const reply_markup = {
                force_reply: true,
            };
            const new_msg = await botInstance.sendMessage(chatId, caption, {
                parse_mode: "HTML",
                reply_markup,
            });
            botInstance.onReplyToMessage(new_msg.chat.id, new_msg.message_id, async (n_msg: any) => {
                if (!botInstance) {
                    logger.error("Bot instance not initialized in sellPortfolio onReplyToMessage callback");
                    return;
                }

                botInstance.deleteMessage(new_msg.chat.id, new_msg.message_id);
                botInstance.deleteMessage(n_msg.chat.id, n_msg.message_id);

                if (n_msg.text) {
                    const sellAmount = parseInt(tokenInfo.amount) * parseFloat(n_msg.text) / 100;
                    await botInstance.sendMessage(chatId, `Selling ${sellAmount / Math.pow(10, tokenInfo.decimals)} ${metaData?.symbol} of ${metaData?.name}(${metaData?.symbol}) `, {
                        parse_mode: "HTML",
                    });
                    const result = await jupiter_swap(SOLANA_CONNECTION, wallet.privateKey, tokenAddress, WSOL_ADDRESS, sellAmount, "ExactIn");
                    if (result.confirmed) {
                        await botInstance.sendMessage(chatId, `Successfully sell ${sellAmount / Math.pow(10, tokenInfo.decimals)} ${metaData?.symbol} of ${metaData?.name}(${metaData?.symbol}) 
            https://solscan.io/tx/${result.txSignature}`, {
                            parse_mode: "HTML",
                        });
                    } else {
                        await botInstance.sendMessage(chatId, `Failed to sell ${metaData?.name}(${metaData?.symbol}). Please try again.`, {
                            parse_mode: "HTML",
                        });
                    }
                }
            });
        } else {
            const sellAmount = parseInt(tokenInfo.amount) * parseInt(amount) / 100;
            await botInstance.sendMessage(chatId, `Selling ${sellAmount / Math.pow(10, tokenInfo.decimals)} ${metaData?.symbol} of ${metaData?.name}(${metaData?.symbol}) `, {
                parse_mode: "HTML",
            });
            const result = await jupiter_swap(SOLANA_CONNECTION, wallet.privateKey, tokenAddress, WSOL_ADDRESS, sellAmount, "ExactIn");
            if (result.confirmed) {
                await botInstance.sendMessage(chatId, `Successfully sell ${sellAmount / Math.pow(10, tokenInfo.decimals)} ${metaData?.symbol} of ${metaData?.name}(${metaData?.symbol}) 
https://solscan.io/tx/${result.txSignature}`, {
                    parse_mode: "HTML",
                });
            } else {
                await botInstance.sendMessage(chatId, `Failed to sell ${metaData?.name}(${metaData?.symbol}). Please try again.`, {
                    parse_mode: "HTML",
                });
            }
        }

    } catch (e) {
        logger.error("PortfolioPad Error", e);
    }
} 