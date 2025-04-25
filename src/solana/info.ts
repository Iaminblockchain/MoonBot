
import {
    Connection,
    ParsedInstruction,
    PublicKey
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    AccountLayout,
    TOKEN_2022_PROGRAM_ID,
    getMint,
    getAccount,
    getAssociatedTokenAddressSync,
    getOrCreateAssociatedTokenAccount,
    createTransferInstruction,
    getAssociatedTokenAddress,
} from "@solana/spl-token";
import { logger } from "../logger";

import { FEE_COLLECTION_WALLET, JITO_TIP, SOLANA_CONNECTION } from "..";

async function getTokenAddressFromTokenAccount(tokenAccountAddress: string) {
    try {
        const tokenAccountPubkey = new PublicKey(tokenAccountAddress);
        const accountInfo = await SOLANA_CONNECTION.getAccountInfo(tokenAccountPubkey);

        if (accountInfo === null) {
            throw new Error("Token account not found");
        }

        const accountData = AccountLayout.decode(accountInfo.data);
        const mintAddress = new PublicKey(accountData.mint);

        return mintAddress.toBase58();
    } catch (error) {
        logger.error("Error fetching token address:", error);
    }
}


export const getTokenSwapInfo = async (
    connection: Connection,
    signature: string
) => {
    logger.info("getTokenSwapInfo, start");
    try {
        const tx = await connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
        });

        const instructions = tx!.transaction.message.instructions;

        const innerinstructions = tx!.meta!.innerInstructions;

        // check if this is raydium swap trx
        const raydiumPoolV4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
        const jupiterAggregatorV6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
        for (let i = 0; i < instructions.length; i++) {
            if (instructions[i].programId.toBase58() === raydiumPoolV4) {
                for (let j = 0; j < innerinstructions!.length; j++) {
                    if (innerinstructions![j].index === i) {
                        const sendToken = await getTokenAddressFromTokenAccount(
                            (innerinstructions![j].instructions[0] as ParsedInstruction)
                                .parsed.info.destination
                        );
                        const sendAmount = (
                            innerinstructions![j].instructions[0] as ParsedInstruction
                        ).parsed.info.amount;
                        const receiveToken = await getTokenAddressFromTokenAccount(
                            (innerinstructions![j].instructions[1] as ParsedInstruction)
                                .parsed.info.source
                        );
                        const receiveAmount = (
                            innerinstructions![j].instructions[1] as ParsedInstruction
                        ).parsed.info.amount;
                        const result = {
                            isSwap: true,
                            type: "raydium swap",
                            sendToken: sendToken,
                            sendAmount: sendAmount,
                            receiveToken: receiveToken,
                            receiveAmount: receiveAmount,
                        };
                        return result;
                    }
                }
            } else if (instructions[i].programId.toBase58() === jupiterAggregatorV6) {
                for (let j = 0; j < innerinstructions!.length; j++) {
                    if (innerinstructions![j].index === i) {
                        const length = innerinstructions![j].instructions.length;
                        let sendToken;
                        let sendAmount;
                        let receiveToken;
                        let receiveAmount;
                        for (let i = 0; i < length; i++) {
                            if (
                                (
                                    innerinstructions![j].instructions[i] as ParsedInstruction
                                ).programId.toBase58() ==
                                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
                            ) {
                                if (
                                    (innerinstructions![j].instructions[i] as ParsedInstruction)
                                        .parsed.type == "transferChecked"
                                ) {
                                    sendToken = await getTokenAddressFromTokenAccount(
                                        (innerinstructions![j].instructions[i] as ParsedInstruction)
                                            .parsed.info.destination
                                    );
                                    sendAmount = (
                                        innerinstructions![j].instructions[i] as ParsedInstruction
                                    ).parsed.info.tokenAmount.amount;
                                    break;
                                }

                                if (
                                    (innerinstructions![j].instructions[i] as ParsedInstruction)
                                        .parsed.type == "transfer"
                                ) {
                                    sendToken = await getTokenAddressFromTokenAccount(
                                        (innerinstructions![j].instructions[i] as ParsedInstruction)
                                            .parsed.info.destination
                                    );
                                    sendAmount = (
                                        innerinstructions![j].instructions[i] as ParsedInstruction
                                    ).parsed.info.amount;
                                    break;
                                }
                            }
                        }

                        for (let i = length - 1; i >= 0; i--) {
                            if (
                                (
                                    innerinstructions![j].instructions[i] as ParsedInstruction
                                ).programId.toBase58() ==
                                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
                            ) {
                                if (
                                    (innerinstructions![j].instructions[i] as ParsedInstruction)
                                        .parsed.type == "transferChecked"
                                ) {
                                    receiveToken = await getTokenAddressFromTokenAccount(
                                        (innerinstructions![j].instructions[i] as ParsedInstruction)
                                            .parsed.info.source
                                    );
                                    receiveAmount = (
                                        innerinstructions![j].instructions[i] as ParsedInstruction
                                    ).parsed.info.tokenAmount.amount;
                                    break;
                                }

                                if (
                                    (innerinstructions![j].instructions[i] as ParsedInstruction)
                                        .parsed.type == "transfer"
                                ) {
                                    receiveToken = await getTokenAddressFromTokenAccount(
                                        (innerinstructions![j].instructions[i] as ParsedInstruction)
                                            .parsed.info.source
                                    );
                                    receiveAmount = (
                                        innerinstructions![j].instructions[i] as ParsedInstruction
                                    ).parsed.info.amount;
                                    break;
                                }
                            }
                        }

                        const result = {
                            isSwap: true,
                            type: "jupiter swap",
                            sendToken: sendToken,
                            sendAmount: sendAmount,
                            receiveToken: receiveToken,
                            receiveAmount: receiveAmount,
                            blockTime: tx?.blockTime,
                        };
                        logger.info("swap info = ", { result });
                        return result;
                    }
                }
            }
        }

        return {
            isSwap: false,
            type: null,
            sendToken: null,
            sendAmount: null,
            receiveToken: null,
            receiveAmount: null,
            blockTime: null,
        };
    } catch (error) {
        logger.error("getTokenSwapInfo, Error");
        return {
            isSwap: false,
            type: null,
            sendToken: null,
            sendAmount: null,
            receiveToken: null,
            receiveAmount: null,
            blockTime: null,
        };
    }
};
