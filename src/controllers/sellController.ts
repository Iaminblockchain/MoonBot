import TelegramBot from "node-telegram-bot-api";
import { botInstance, switchMenu, getChatIdandMessageId, setState, STATE, setDeleteMessageId, getDeleteMessageId } from "../bot";
import { SOLANA_CONNECTION } from '../config';
import * as walletdb from '../models/walletModel';
import * as tradedb from '../models/tradeModel';
import * as solana from '../solana';
import { PublicKey, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export const handleCallBackQuery = (query: TelegramBot.CallbackQuery) => {
    try {
        const data = query.data;
        console.log("~~dataaaa", data)
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
        } else if (data && data.includes("sc_t_")){
            onClickSellWithToken(query)
        }
    } catch (error) {

    }

}

const onClick25Sell = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    //const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && query && query.data) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);
        let queryData = query.data.split("_"); 
        const tokenAddress =  queryData[3];
        const tokenBalance = queryData[2];
        // const tokenAddress =  query.data.split("sc_25%_")[1]
        console.log("~~fetching tokenBalance", tokenAddress)
        // const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, tokenAddress);
        console.log("~~~~tokenBalance", tokenBalance);
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey, publicKey, tokenAddress, solana.WSOL_ADDRESS, 0.25 * Number(tokenBalance), "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Sell successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Sell failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending sell transaction');
    }
}

const onClick50Sell = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    // const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && query && query.data) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);
        let queryData = query.data.split("_"); 
        const tokenAddress =  queryData[3];
        const tokenBalance = queryData[2];
        // const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey, publicKey, tokenAddress, solana.WSOL_ADDRESS, 0.5 * Number(tokenBalance), "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Sell successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Sell failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending sell transaction');
    }
}

const onClick75Sell = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    // const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet && query && query.data) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);
        let queryData = query.data.split("_"); 
        const tokenAddress =  queryData[3];
        const tokenBalance = queryData[2];
        // const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey, publicKey, tokenAddress, solana.WSOL_ADDRESS, 0.75 * Number(tokenBalance), "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Sell successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Sell failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending sell transaction');
    }
}

const onClick100Sell = async (query: TelegramBot.CallbackQuery) => {
    const { chatId, messageId } = getChatIdandMessageId(query);
    const wallet = await walletdb.getWalletByChatId(chatId!);
    // const trade = await tradedb.getTradeByChatId(chatId!);
    if (wallet &&  query && query.data) {
        const privateKey = wallet.privateKey;
        const publicKey = solana.getPublicKey(privateKey);
        let queryData = query.data.split("_"); 
        const tokenAddress =  queryData[3];
        const tokenBalance = queryData[2];
        // const tokenBalance = await solana.getTokenBalance(SOLANA_CONNECTION, publicKey, trade.tokenAddress);
        solana.jupiter_swap(SOLANA_CONNECTION, privateKey, publicKey, tokenAddress, solana.WSOL_ADDRESS, 1 * Number(tokenBalance), "ExactIn").then((result) => {
            if (result.confirmed) {
                botInstance.sendMessage(chatId!, 'Sell successfully');
            } else {
                botInstance.sendMessage(chatId!, 'Sell failed');
            }
        });
        botInstance.sendMessage(chatId!, 'Sending sell transaction');
    }
}

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
        const buttons = tokenAccounts.map(token => [           
            { text: `Sell ${token.symbol} (${token.balance})`, callback_data: `sc_t_${token.balance}_${token.address}`}
        ]);

        const title = `<b>Your Tokens</b>\nSelect a token to sell:`;
        
        botInstance.sendMessage(chatId!, title, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' });
    } catch (error) {
        console.error("Error in showSellPad:", error);
        botInstance.sendMessage(query.message!.chat.id, "❌ Failed to fetch wallet tokens.");
    }
};

export const onClickSellWithToken = async (query: TelegramBot.CallbackQuery) => {
    try {
        const { chatId, messageId } = getChatIdandMessageId(query);
        // const trade = await tradedb.getTradeByChatId(chatId!);
        const wallet = await walletdb.getWalletByChatId(chatId!);
        if(query && query.data && wallet){
            let queryData = query.data.split("_"); 
            const token =  queryData[3];
            const balance = queryData[2];
            const buttons = [
                [
                    { text: 'Sell 25%', callback_data: `sc_25%_${balance}_${token}` },
                    { text: 'Sell 50%', callback_data: `sc_50%_${balance}_${token}` },
                    { text: 'Sell 75%', callback_data: `sc_75%_${balance}_${token}` },
                    { text: 'Sell 100%', callback_data: `sc_100%_${balance}_${token}` }
                ],
                [
                    { text: 'Refresh', callback_data: "sc_refresh" }
                ]
            ]
            botInstance.sendMessage(chatId!, `Selling ${token}. Select percentage`, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' })
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
    } catch (error) {

    }
}