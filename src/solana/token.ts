import {
    Connection,
    PublicKey,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    getMint,
    getAccount,
    getAssociatedTokenAddressSync,
    getOrCreateAssociatedTokenAccount,
    createTransferInstruction,
    getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
    Keypair,
    VersionedTransaction,
    TransactionMessage
} from "@solana/web3.js";

import { Metaplex } from "@metaplex-foundation/js";
import { SOLANA_CONNECTION } from "..";
import { logger } from "../logger";
import { getWalletByChatId } from "../models/walletModel";
import { submitAndConfirm } from "./trade";
import { getKeypair } from "./util";

export const getTokenMetaData = async (
    CONNECTION: Connection,
    address: string
) => {
    try {
        const metaplex = Metaplex.make(CONNECTION);
        const mintAddress = new PublicKey(address);
        const token = await metaplex
            .nfts()
            .findByMint({ mintAddress: mintAddress });
        let mintInfo = null;
        let totalSupply = 0;
        let token_type = "spl-token";
        if (token) {
            const name = token.name;
            const symbol = token.symbol;
            const logo = token.json?.image;
            const description = token.json?.description;
            const extensions = token.json?.extensions;
            const decimals = token.mint.decimals;
            const renounced = token.mint.mintAuthorityAddress ? false : true;

            if (token.mint.currency.namespace === "spl-token") {
                mintInfo = await getMint(
                    CONNECTION,
                    mintAddress,
                    "confirmed",
                    TOKEN_PROGRAM_ID
                );
                token_type = "spl-token";
            } else {
                mintInfo = await getMint(
                    CONNECTION,
                    mintAddress,
                    "confirmed",
                    TOKEN_2022_PROGRAM_ID
                );
                token_type = "spl-token-2022";
            }
            if (mintInfo) {
                totalSupply = Number(mintInfo.supply / BigInt(10 ** decimals));
            }
            const metaData = {
                name,
                symbol,
                logo,
                decimals,
                address,
                totalSupply,
                description,
                extensions,
                renounced,
                type: token_type,
            };
            return metaData;
        } else {
            logger.info("utils.getTokenMetadata tokenInfo", { token });
        }
    } catch (error) {
        logger.error("getTokenMetadata", { error });
    }
    return null;
};

export const getTokenBalance = async (
    CONNECTION: Connection,
    walletAddress: string,
    tokenAddress: string
) => {
    const walletPublicKey = new PublicKey(walletAddress);
    const tokenPublicKey = new PublicKey(tokenAddress);
    const associatedTokenAddress = await PublicKey.findProgramAddress(
        [
            walletPublicKey.toBuffer(),
            TOKEN_PROGRAM_ID.toBuffer(),
            tokenPublicKey.toBuffer(),
        ],
        new PublicKey("ATokenGPvnNbtrh4MGx8o8wK7bPt6MrdAz7hKkG6QRJA")
    );

    try {
        const tokenAccount = await getAccount(
            CONNECTION,
            associatedTokenAddress[0]
        );
        const balance = tokenAccount;
        return balance;
    } catch (error) {
        logger.error("Error fetching token balance:", error);
        return null;
    }
};

export const getTokenInfofromMint = async (wallet: PublicKey, tokenAddress: string) => {
    const tokenPublicKey = new PublicKey(tokenAddress);
    const tokenAccount = getAssociatedTokenAddressSync(tokenPublicKey, wallet);
    try {
        const info = await SOLANA_CONNECTION.getTokenAccountBalance(tokenAccount);
        logger.info("info: ", { info })
        return info.value;
    } catch (error) {
        logger.error("Error fetching token balance:", error);
        return null;
    }
}

export const sendSPLtokens = async (chatId: string, mint: string, destination: string, amount: number, isPercentage: boolean) => {
    try {
        const wallet = await getWalletByChatId(chatId);
        const owner: Keypair = getKeypair(wallet!.privateKey);
        const tokenInfo = await getTokenInfofromMint(owner.publicKey, mint)
        if (!tokenInfo) return { confirmed: false };
        let sendAmount: number;
        if (isPercentage) {
            sendAmount = Math.floor(tokenInfo.uiAmount! * Math.pow(10, tokenInfo.decimals) * amount / 100);
        } else {
            sendAmount = Math.floor(amount * Math.pow(10, tokenInfo.decimals));
        }
        let sourceAccount = await getAssociatedTokenAddress(
            new PublicKey(mint),
            owner.publicKey,
            true
        );

        let destinationAccount = await getOrCreateAssociatedTokenAccount(
            SOLANA_CONNECTION,
            owner,
            new PublicKey(mint),
            new PublicKey(destination),
            true
        );

        const txinstruction = createTransferInstruction(
            sourceAccount,
            destinationAccount.address,
            owner.publicKey,
            sendAmount
        )
        const latestBlockHash = await SOLANA_CONNECTION.getLatestBlockhash('confirmed');
        const message = new TransactionMessage({
            payerKey: owner.publicKey,  // Fee payer
            recentBlockhash: latestBlockHash.blockhash, // Recent blockhash
            instructions: [txinstruction], // Array of instructions
        }).compileToV0Message();

        const tx = new VersionedTransaction(message);
        tx.sign([owner]);

        const res = await submitAndConfirm(tx);

        if (res.confirmed) {
            return { confirmed: true, txSignature: res.signature };
        } else {
            return { confirmed: false }
        }
    } catch (e) {
        logger.error("sendSPLtokens", { error: e });
        return { confirmed: false }
    }
}
