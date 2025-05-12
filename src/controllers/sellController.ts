import TelegramBot from "node-telegram-bot-api";
import {
    botInstance,
    switchMenu,
    getChatIdandMessageId,
    setState,
    STATE,
    setDeleteMessageId,
    getDeleteMessageId,
    trade,
    TRADE,
    removeTradeState,
} from "../bot";
import { SOLANA_CONNECTION } from "..";
import * as walletdb from "../models/walletModel";
import * as tradedb from "../models/tradeModel";
import * as solana from "../solana/trade";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
const { PublicKey } = require("@solana/web3.js"); // Import PublicKey
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { autoBuySettings, getSPLBalance } from "./autoBuyController";
import { getTokenPrice } from "../getPrice";
import { logger } from "../logger";
import { getTokenMetaData } from "../solana/token";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in sellController.handleCallBackQuery");
        return;
    }

    try {
        const data = query.data;
        if (data == "sc_start") {
            showSellPad(query);
        } else if (data && data.includes("sc_25%_")) {
            onClick25Sell(query);
        } else if (data && data.includes("sc_50%_")) {
            onClick50Sell(query);
        } else if (data && data.includes("sc_75%_")) {
            onClick75Sell(query);
        } else if (data && data.includes("sc_100%_")) {
            onClick100Sell(query);
        } else if (data && data.includes("sc_t_")) {
            onClickSellWithToken(query);
        }
    } catch (error) {
        logger.error("Error in handleCallBackQuery", { error });
    }
};

// Generic sell handler: sells a fraction of the user's token balance.
const onClickSell = async (query: TelegramBot.CallbackQuery, fraction: number, wrapUnwrapSOL: boolean = false): Promise<void> => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onClickSell");
        return;
    }

    const { chatId } = getChatIdandMessageId(query);
    logger.info("onClickSell called", { chatId, fraction, wrapUnwrapSOL });

    const wallet = await walletdb.getWalletByChatId(chatId!);
    if (!wallet || !query.data) {
        logger.warn("Wallet or query data missing", { chatId });
        return;
    }

    const privateKey = wallet.privateKey;
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const [, , tokenAddress] = query.data.split("_");

    const tokenATA = getAssociatedTokenAddressSync(new PublicKey(tokenAddress), keypair.publicKey);
    const tokenBalance = await SOLANA_CONNECTION.getTokenAccountBalance(tokenATA);
    const amountToSell = fraction * Number(tokenBalance.value.amount);

    logger.info("Preparing to send transaction", { tokenAddress, amountToSell });
    await botInstance.sendMessage(chatId!, "Sending sell transaction");

    try {
        const result = await solana.jupiter_swap(
            SOLANA_CONNECTION,
            privateKey,
            tokenAddress,
            solana.WSOL_ADDRESS,
            amountToSell,
            "ExactIn",
            wrapUnwrapSOL
        );
        if (result && result.confirmed) {
            logger.info("Sell transaction result", { confirmed: result.confirmed });
            const message = result.confirmed ? "Sell successfully" : "Sell failed";
            await botInstance.sendMessage(chatId!, message);
        } else {
            logger.error("Sell transaction failed", { result });
            await botInstance.sendMessage(chatId!, "Sell failed");
        }
    } catch (error: any) {
        logger.error("Sell error", { error });
        await botInstance.sendMessage(chatId!, `Sell error: ${error.message}`);
    }
};

// Specific percentage handlers:
export const onClick25Sell = async (query: TelegramBot.CallbackQuery): Promise<void> => onClickSell(query, 0.25, true);

export const onClick50Sell = async (query: TelegramBot.CallbackQuery): Promise<void> => onClickSell(query, 0.5);

export const onClick75Sell = async (query: TelegramBot.CallbackQuery): Promise<void> => onClickSell(query, 0.75);

export const onClick100Sell = async (query: TelegramBot.CallbackQuery): Promise<void> => onClickSell(query, 1);

// export const showSellPad = async (query: TelegramBot.CallbackQuery) => {
//     try {
//         const { chatId, messageId } = getChatIdandMessageId(query);
//         const trade = await tradedb.getTradeByChatId(chatId!);
//         const wallet = await walletdb.getWalletByChatId(chatId!);
//         if (trade && wallet) {
//             const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, trade.tokenAddress);
//             const publicKey = solana.getPublicKey(wallet.privateKey);
//             const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
//             const title = `<b>Sell</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${trade.tokenAddress}</code>\n\nBalance: ${Number(tokenBalance!) / (10 ** metaData!.decimals)} ${metaData!.symbol}`
//             const buttons = [
//                 [
//                     { text: 'Sell 25%', callback_data: "sc_25%" },
//                     { text: 'Sell 50%', callback_data: "sc_50%" },
//                     { text: 'Sell 75%', callback_data: "sc_75%" },
//                     { text: 'Sell 100%', callback_data: "sc_100%" }
//                 ],
//                 [
//                     { text: 'Refresh', callback_data: "sc_refresh" }
//                 ]
//             ]
//             botInstance.sendMessage(chatId!, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' })
//         }
//     } catch (error) {

//     }
// }

export const getPublicKeyinFormat = (privateKey: string) => {
    // Decode the base58 private key into Uint8Array
    const secretKeyUint8Array = new Uint8Array(bs58.decode(privateKey));

    // Create a Keypair from the secret key
    const keypair = Keypair.fromSecretKey(secretKeyUint8Array);

    // Return the public key as a string
    return keypair.publicKey;
};

export const showSellPad = async (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in showSellPad");
        return;
    }

    try {
        const { chatId } = getChatIdandMessageId(query);
        const wallet = await walletdb.getWalletByChatId(chatId!);

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
        // Generate buttons for each token
        const buttons = tokenAccounts.map((token) => [
            { text: `Sell ${token.symbol} (${token.balance})`, callback_data: `sc_t_${token.address}` },
        ]);

        const title = `<b>Your Tokens</b>\nSelect a token to sell:`;

        botInstance.sendMessage(chatId!, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: "HTML" });
    } catch (error) {
        logger.error("Error in showSellPad:", error);
        if (botInstance && query.message) {
            botInstance.sendMessage(query.message.chat.id, "❌ Failed to fetch wallet tokens.");
        }
    }
};

export const onClickSellWithToken = async (query: TelegramBot.CallbackQuery) => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in onClickSellWithToken");
        return;
    }

    try {
        const { chatId, messageId } = getChatIdandMessageId(query);
        // const trade = await tradedb.getTradeByChatId(chatId!);
        const wallet = await walletdb.getWalletByChatId(chatId!);
        if (query && query.data && wallet) {
            let queryData = query.data.split("_");
            const token = queryData[2];
            const buttons = [
                [
                    { text: "Sell 25%", callback_data: `sc_25%_${token}` },
                    { text: "Sell 50%", callback_data: `sc_50%_${token}` },
                    { text: "Sell 75%", callback_data: `sc_75%_${token}` },
                    { text: "Sell 100%", callback_data: `sc_100%_${token}` },
                ],
                [{ text: "Refresh", callback_data: "sc_refresh" }],
            ];
            botInstance.sendMessage(chatId!, `Selling ${token}. Select percentage`, {
                reply_markup: { inline_keyboard: buttons },
                parse_mode: "HTML",
            });
        }
        // if (trade && wallet) {
        //     const metaData = await solana.getTokenMetaData(SOLANA_CONNECTION, trade.tokenAddress);
        //     const publicKey = solana.getPublicKey(wallet.privateKey);
        //     const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
        //     const title = `<b>Sell</b> ${metaData!.symbol} - (${metaData!.name})\n<code>${trade.tokenAddress}</code>\n\nBalance: ${Number(tokenBalance!) / (10 ** metaData!.decimals)} ${metaData!.symbol}`
        //     const buttons = [
        //         [
        //             { text: 'Sell 25%', callback_data: "sc_25%" },
        //             { text: 'Sell 50%', callback_data: "sc_50%" },
        //             { text: 'Sell 75%', callback_data: "sc_75%" },
        //             { text: 'Sell 100%', callback_data: "sc_100%" }
        //         ],
        //         [
        //             { text: 'Refresh', callback_data: "sc_refresh" }
        //         ]
        //     ]
        //     botInstance.sendMessage(chatId!, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' })
        // }
    } catch (error) {}
};

//run through each signal and check if sell is triggered
export const autoSellHandler = () => {
    if (!botInstance) {
        logger.error("Bot instance not initialized in autoSellHandler");
        return;
    }

    trade.forEach(async (value, key) => {
        value.map(async (info: TRADE) => {
            try {
                const price = await getTokenPrice(info.contractAddress);
                // botInstance.sendMessage(key!, `Auto-sell Check: ${info.contractAddress}, Current Price: ${price}, Target Price: ${info.targetPrice}`);
                logger.debug("Auto-sell check", { chatId: key, address: info.contractAddress, price });
                if (price > info.targetPrice || price < info.lowPrice) {
                    const wallet = await walletdb.getWalletByChatId(key);
                    if (!wallet) return;
                    const walletData = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
                    const splAmount = await getSPLBalance(info.contractAddress, walletData.publicKey.toBase58());
                    if (splAmount === 0) {
                        removeTradeState(key, info.contractAddress);
                    }
                    let result = await solana.jupiter_swap(
                        SOLANA_CONNECTION,
                        wallet.privateKey,
                        info.contractAddress,
                        solana.WSOL_ADDRESS,
                        splAmount,
                        "ExactIn",
                        false
                    );

                    if (result && result.confirmed) {
                        if (!botInstance) {
                            logger.error("Bot instance not initialized in autoSellHandler result handler");
                            return;
                        }

                        const metadata = await getTokenMetaData(SOLANA_CONNECTION, info.contractAddress);
                        if (price > info.targetPrice) {
                            botInstance.sendMessage(
                                key,
                                `Auto-Sell Token : You successfully sold ${metadata?.name}(${metadata?.symbol}) : ${info.contractAddress} at Price: $${price} for a ${((price / info.startPrice - 1) * 100).toFixed(1)}% gain `
                            );
                        } else if (price < info.lowPrice) {
                            botInstance.sendMessage(
                                key,
                                `Auto-Sell Token : You successfully sold ${metadata?.name}(${metadata?.symbol}) : ${info.contractAddress} at Price: $${price} for a ${((1 - price / info.startPrice) * 100).toFixed(1)}% loss `
                            );
                        }
                        removeTradeState(key, info.contractAddress);
                    } else {
                        if (!botInstance) {
                            logger.error("Bot instance not initialized in autoSellHandler else branch");
                            return;
                        }

                        botInstance.sendMessage(key, `Auto-Sell Token : ${info.contractAddress}  failed`);
                        removeTradeState(key, info.contractAddress);
                    }
                }
            } catch (e) {
                logger.error(`Auto-Sell Error:${e}`, { chatId: key, TokenAddress: info.contractAddress });
            }
        });
    });
};
