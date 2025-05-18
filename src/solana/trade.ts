import bs58 from "bs58";
import {
    Keypair,
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
    ParsedAccountData,
    VersionedTransaction,
    TransactionMessage,
    BlockhashWithExpiryBlockHeight,
    SignatureStatus,
    TransactionSignature,
    TransactionConfirmationStatus,
    AddressLookupTableAccount,
    TransactionInstruction,
} from "@solana/web3.js";
import { getRandomValidator } from "./util";
import axios from "axios";
import { FEE_COLLECTION_WALLET, JITO_TIP, SOLANA_CONNECTION } from "..";
import { getChatIdByPrivateKey, getWalletByChatId, getReferralWallet } from "../models/walletModel";
import { getKeypair } from "./util";
import { logger } from "../logger";
import { getTokenMetaData } from "./token";
import { getStatusTxnRetry, getTxInfoMetrics, TransactionMetrics } from "./txhelpers";
import { getReferralByRefereeId, updateRewards } from "../models/referralModel";

export const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
export const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const LAMPORTS = LAMPORTS_PER_SOL;
const whitelistedUsers: string[] = require("../util/whitelistUsers.json");
const SOL_MINT = "So11111111111111111111111111111111111111112";

import { getErrorMessage } from "../util/error";

const useJito = false;

interface ReferralInfo {
    key: string;
    referer: string | null;
    amount: number;
}

interface RawInstruction {
    programId: string;
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    data: string;
}

const endpoints = [
    "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
];

/**
 * Sends SOL from one wallet to another
 * @param senderPrivateKey - Private key of the sender wallet
 * @param receiverAddress - Public key of the receiver wallet
 * @param amount - Amount of SOL to send
 * @returns Transaction signature if successful, null if failed
 */
const sendSOL = async (senderPrivateKey: string, receiverAddress: string, amount: number) => {
    try {
        let privateKey_nums = bs58.decode(senderPrivateKey);
        let senderKeypair = Keypair.fromSecretKey(privateKey_nums);

        let transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: new PublicKey(receiverAddress),
                lamports: Math.round(LAMPORTS_PER_SOL * amount),
            })
        );
        transaction.feePayer = senderKeypair.publicKey;
        const signature = await sendAndConfirmTransaction(SOLANA_CONNECTION, transaction, [senderKeypair]);
        logger.info("Send SOL TX: ", { signature });
        return signature;
    } catch (error: unknown) {
        logger.error("Send SOL Error: ", { error: getErrorMessage(error) });
        return null;
    }
};

interface SwapQuote {
    inAmount: string;
    outAmount: string;
    [key: string]: string | number | undefined;
}

interface AccountMetaData {
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
}

interface SwapInstructionsResponse {
    tokenLedgerInstruction?: RawInstruction[];
    computeBudgetInstructions: RawInstruction[];
    setupInstructions: RawInstruction[];
    swapInstruction: RawInstruction;
    cleanupInstruction: RawInstruction;
    addressLookupTableAddresses: string[];
    error?: string;
}

async function getSwapInstructions(
    quote: SwapQuote,
    userPublicKey: string,
    wrapAndUnwrapSol = true
): Promise<{
    instructions: TransactionInstruction[];
    addressLookupTableAccounts: AddressLookupTableAccount[];
}> {
    // 1) fetch the raw instruction payloads
    const res = await fetch("https://api.jup.ag/swap/v1/swap-instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey,
            wrapAndUnwrapSol,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: {
                priorityLevelWithMaxLamports: {
                    maxLamports: 50_000_000,
                    priorityLevel: "veryHigh",
                },
            },
        }),
    }).then((r) => r.json() as Promise<SwapInstructionsResponse>);

    if (res.error) throw new Error("Swap-instructions error: " + res.error);

    // 2) helper to decode each payload into a TransactionInstruction
    const deserialize = (instr: RawInstruction) =>
        new TransactionInstruction({
            programId: new PublicKey(instr.programId),
            keys: instr.accounts.map((a: AccountMetaData) => ({
                pubkey: new PublicKey(a.pubkey),
                isSigner: a.isSigner,
                isWritable: a.isWritable,
            })),
            data: Buffer.from(instr.data, "base64"),
        });

    // 3) turn each section into real instructions
    const allInstr = [
        ...res.computeBudgetInstructions.map(deserialize),
        ...res.setupInstructions.map(deserialize),
        deserialize(res.swapInstruction),
        deserialize(res.cleanupInstruction),
    ];

    // 4) fetch and deserialize any address‑lookup tables
    const lookupAccounts = await Promise.all(
        res.addressLookupTableAddresses.map(async (addr) => {
            const info = await SOLANA_CONNECTION.getAccountInfo(new PublicKey(addr));
            if (!info) return null;
            return new AddressLookupTableAccount({
                key: new PublicKey(addr),
                state: AddressLookupTableAccount.deserialize(info.data),
            });
        })
    );

    return {
        instructions: allInstr,
        addressLookupTableAccounts: lookupAccounts.filter((x): x is AddressLookupTableAccount => !!x),
    };
}

const MAX_ATTEMPTS = 3;

async function sendWithRetries(
    connection: Connection,
    payer: Keypair,
    instructions: TransactionInstruction[],
    lookupTables: AddressLookupTableAccount[],
    useJito: boolean
): Promise<{ confirmed: boolean; signature: string | null }> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("processed");
        const messageV0 = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message(lookupTables);
        const tx = new VersionedTransaction(messageV0);
        tx.sign([payer]);

        // call Jito or RPC
        const raw = useJito
            ? await jito_executeAndConfirm(connection, tx, payer, { blockhash, lastValidBlockHeight }, JITO_TIP)
            : await submitAndConfirm(tx);

        // normalize signature to string|null
        const confirmed = raw.confirmed;
        const signature = raw.signature ?? null;

        if (confirmed) {
            return { confirmed, signature };
        }

        logger.info(`Attempt ${attempt} failed, retrying…`);
    }

    return { confirmed: false, signature: null };
}

export interface SwapResult {
    success: boolean;
    txSignature?: string | null;
    token_balance_change: number;
    sol_balance_change: number;
    execution_price: number;
    error?: string;
    executionInfo?: TransactionMetrics;
}

export const buy_swap = async (
    CONNECTION: Connection,
    PRIVATE_KEY: string,
    tokenAddress: string,
    amount: number,
    slippage?: number
): Promise<SwapResult> => {
    const result = await jupiter_swap(CONNECTION, PRIVATE_KEY, WSOL_ADDRESS, tokenAddress, amount, "ExactIn", useJito, slippage);

    if (result && result.confirmed) {
        logger.info("execution info", { executionInfo: result.executionInfo });

        let token_balance_change = 0;
        let sol_balance_change = 0;
        let execution_price = 0;
        if (result.executionInfo) {
            token_balance_change = Number(result.executionInfo.token_balance_change);
            sol_balance_change = Number(result.executionInfo.sol_balance_change);
            execution_price = Number(result.executionInfo.execution_price);
        }

        return {
            success: true,
            txSignature: result.txSignature,
            token_balance_change: token_balance_change,
            sol_balance_change: sol_balance_change,
            execution_price: execution_price,
        };
    } else {
        return {
            success: false,
            token_balance_change: 0,
            sol_balance_change: 0,
            execution_price: 0,
            error: "Swap failed to confirm",
        };
    }
};

export const sell_swap = async (
    CONNECTION: Connection,
    PRIVATE_KEY: string,
    tokenAddress: string,
    amount: number,
    slippage?: number
): Promise<SwapResult> => {
    const result = await jupiter_swap(CONNECTION, PRIVATE_KEY, tokenAddress, WSOL_ADDRESS, amount, "ExactIn", useJito);
    if (result && result.confirmed) {
        logger.info("execution info", { executionInfo: result.executionInfo });

        let token_balance_change = 0;
        let sol_balance_change = 0;
        let execution_price = 0;
        if (result.executionInfo) {
            token_balance_change = Number(result.executionInfo.token_balance_change);
            sol_balance_change = Number(result.executionInfo.sol_balance_change);
            execution_price = Number(result.executionInfo.execution_price);
        }
        //TODO: store
        return {
            success: true,
            txSignature: result.txSignature,
            token_balance_change: token_balance_change,
            sol_balance_change: sol_balance_change,
            execution_price: execution_price,
        };
    } else {
        return {
            success: false,
            token_balance_change: 0,
            sol_balance_change: 0,
            execution_price: 0,
            error: "Swap failed to confirm",
        };
    }
};

/**
 * Executes a swap transaction using Jupiter aggregator
 * @param CONNECTION - Solana connection instance
 * @param PRIVATE_KEY - User's private key
 * @param inputMint - Input token mint address
 * @param outputMint - Output token mint address
 * @param amount - Amount to swap
 * @param swapMode - "ExactIn" or "ExactOut" swap mode
 * @param isJito - Whether to use Jito for transaction
 * @param slippage - Slippage tolerance in basis points (default: 500)
 * @returns Swap result with transaction details
 */
export const jupiter_swap = async (
    CONNECTION: Connection,
    PRIVATE_KEY: string,
    inputMint: string,
    outputMint: string,
    amount: number,
    swapMode: "ExactIn" | "ExactOut",
    isJito: boolean = true,
    slippage: number = 500
) => {
    try {
        logger.info(`jupiter_swap ${inputMint} ${outputMint} ${amount} ${swapMode}`);
        const feePayer = new PublicKey(FEE_COLLECTION_WALLET);
        const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
        const quoteUrl =
            `https://api.jup.ag/swap/v1/quote` +
            `?inputMint=${inputMint}` +
            `&outputMint=${outputMint}` +
            `&amount=${Math.floor(amount)}` +
            `&slippageBps=${slippage}` +
            `&swapMode=${swapMode}`;

        logger.info("Fetching quote from Jupiter:", quoteUrl);
        const quoteResponse = await fetch(quoteUrl).then((res) => res.json());
        if (quoteResponse.error) throw new Error("Failed to fetch quote response");
        logger.info("Quote response received", quoteResponse);

        // Get token decimals from metadata
        const tokenMetaData = await getTokenMetaData(CONNECTION, outputMint);
        if (!tokenMetaData?.decimals) {
            logger.error("Failed to get token decimals", { outputMint });
            throw new Error("Failed to get token decimals");
        }

        // Get raw token amount from quote response
        const tokenAmount = parseInt(quoteResponse.outAmount);
        logger.info("Raw token amount:", tokenAmount);

        let feeAmount =
            inputMint === WSOL_ADDRESS
                ? Math.floor(parseInt(quoteResponse.inAmount) / 100)
                : Math.floor(parseInt(quoteResponse.outAmount) / 100);
        logger.info("Calculated feeAmount:", feeAmount);

        const chatId = await getChatIdByPrivateKey(PRIVATE_KEY);

        let referrers: (string | null)[] = [null, null, null, null, null];

        if (chatId) {
            const referral = await getReferralByRefereeId(chatId);
            referrers = referral?.referrers || [null, null, null, null, null];
        }
        let referrerPublicKeys: (string | null)[] = [null, null, null, null, null];
        for (let i = 0; i < referrers.length; i++) {
            if (referrers[i]) {
                // First try to get referral wallet
                let referralWalletPrivateKey = await getReferralWallet(String(referrers[i]));
                let privateKey: string | null = referralWalletPrivateKey;

                // If referral wallet is not set, get the main wallet
                if (!privateKey) {
                    let wallet = await getWalletByChatId(String(referrers[i]));
                    privateKey = wallet?.privateKey || null;
                }

                if (privateKey) {
                    let keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
                    referrerPublicKeys[i] = keypair.publicKey.toString();
                }
            }
        }
        let referrals: ReferralInfo[] = [];
        let referralFeePercentages = [0.25, 0.035, 0.025, 0.02, 0.01];
        let finalFeeAmount = feeAmount;
        if (referrerPublicKeys.indexOf(null) > 0) {
            feeAmount = Math.ceil(feeAmount * 0.9);
            finalFeeAmount = feeAmount;
            for (let i = 0; i < 5; i++) {
                if (referrerPublicKeys[i] != null) {
                    referrals.push({
                        key: referrerPublicKeys[i] as string,
                        referer: referrers[i],
                        amount: Math.floor(feeAmount * referralFeePercentages[i]),
                    });
                    finalFeeAmount -= Math.floor(feeAmount * referralFeePercentages[i]);
                }
            }
        }

        const { instructions, addressLookupTableAccounts } = await getSwapInstructions(quoteResponse, keypair.publicKey.toBase58());

        if (!whitelistedUsers.includes(keypair.publicKey.toBase58())) {
            const feeInstructions: TransactionInstruction[] = [];
            await Promise.all(
                referrals.map(async (referral) => {
                    let isValid = await isValidPublicKey(CONNECTION, referral.key);
                    if (isValid) {
                        const instruction = SystemProgram.transfer({
                            fromPubkey: keypair.publicKey,
                            toPubkey: new PublicKey(referral.key),
                            lamports: referral.amount,
                        });
                        feeInstructions.push(instruction);
                    }
                })
            );

            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: feePayer,
                    lamports: finalFeeAmount,
                })
            );
            instructions.push(...feeInstructions);
        }

        const latestBlockhash = await CONNECTION.getLatestBlockhash();
        const messageV0 = new TransactionMessage({
            payerKey: keypair.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions,
        }).compileToV0Message(addressLookupTableAccounts);

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([keypair]);

        const result = await sendWithRetries(CONNECTION, keypair, instructions, addressLookupTableAccounts, isJito);

        if (!result.confirmed) {
            logger.error("All attempts failed");
            return { confirmed: false, txSignature: null, tokenAmount: 0 };
        }

        // After retry, check if confirmed and validate with getStatusTxnRetry
        if (result.confirmed && result.signature) {
            // execution info, distinguish between SOL and token
            const tokenMint = inputMint === SOL_MINT ? outputMint : inputMint;
            let executionInfo = await getTxInfoMetrics(result.signature, CONNECTION, tokenMint);
            if (executionInfo) {
                logger.info("Execution info", executionInfo);
            }
            const status = await getStatusTxnRetry(CONNECTION, result.signature);
            if (status.success) {
                logger.info("Solana: confirmed");

                //set referrals
                if (referrals.length > 0) {
                    await Promise.all(
                        referrals.map(async (referral) => {
                            if (referral.referer) {
                                await updateRewards(referral.referer, referral.amount);
                                logger.info(`Updated rewards for referer ${referral.referer}: ${referral.amount} lamports`);
                            }
                        })
                    );
                }
                return { confirmed: true, txSignature: result.signature, executionInfo: executionInfo };
            } else {
                logger.error("Txn failed after retry:", status);
                return { confirmed: false, txSignature: result.signature, tokenAmount: 0 };
            }
        } else {
            logger.error("unknown state no signature");
        }
    } catch (error) {
        logger.error("jupiter swap:", { error });
        logger.error(inputMint);
        logger.error(outputMint);
        logger.error(amount);
        logger.error(swapMode);
        logger.error(error);
        return { confirmed: false, txSignature: null, tokenAmount: 0 };
    }
};

/**
 * Executes and confirms a transaction through Jito
 * @param CONNECTION - Solana connection instance
 * @param transaction - Transaction to execute
 * @param payer - Payer keypair
 * @param lastestBlockhash - Latest blockhash info
 * @param jitofee - Jito fee amount
 * @returns Confirmation status and signature
 */
export async function jito_executeAndConfirm(
    CONNECTION: Connection,
    transaction: VersionedTransaction,
    payer: Keypair,
    lastestBlockhash: BlockhashWithExpiryBlockHeight,
    jitofee: number
) {
    const jito_validator_wallet = await getRandomValidator();
    try {
        const jitoFee_message = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: lastestBlockhash.blockhash,
            instructions: [
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: jito_validator_wallet,
                    lamports: jitofee,
                }),
            ],
        }).compileToV0Message();

        const jitoFee_transaction = new VersionedTransaction(jitoFee_message);
        jitoFee_transaction.sign([payer]);
        const txSignature = bs58.encode(transaction.signatures[0]);
        const serializedJitoFeeTransaction = bs58.encode(jitoFee_transaction.serialize());
        const serializedTransaction = bs58.encode(transaction.serialize());
        const final_transaction = [serializedJitoFeeTransaction, serializedTransaction];
        const requests = endpoints.map((url) =>
            axios.post(url, {
                jsonrpc: "2.0",
                id: 1,
                method: "sendBundle",
                params: [final_transaction],
            })
        );
        const res = await Promise.all(requests.map((p) => p.catch((e) => e)));
        const success_res = res.filter((r) => !(r instanceof Error));
        if (success_res.length > 0) {
            logger.info("Jito validator accepted the tx");
            return await jito_confirm(CONNECTION, txSignature, lastestBlockhash);
        } else {
            logger.info("No Jito validators accepted the tx");
            return { confirmed: false, signature: txSignature };
        }
    } catch (e) {
        if (e instanceof axios.AxiosError) {
            logger.error("Failed to execute the jito transaction");
        } else {
            logger.error("Error during jito transaction execution: ", { error: e });
        }
        return { confirmed: false, signature: null };
    }
}

/**
 * Confirms a Jito transaction on Solana
 * @param CONNECTION - Solana connection instance
 * @param signature - Transaction signature
 * @param latestBlockhash - Latest blockhash info
 * @returns Confirmation status and signature
 */
async function jito_confirm(CONNECTION: Connection, signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
    logger.info("Confirming the jito transaction...");
    await confirmTransaction(SOLANA_CONNECTION, signature);
    return { confirmed: true, signature };
}

/**
 * Gets token decimals for a given mint address
 * @param connection - Solana connection instance
 * @param mintAddress - Token mint address
 * @returns Number of decimals or null if failed
 */
export async function getDecimals(connection: Connection, mintAddress: PublicKey) {
    try {
        const info = await connection.getParsedAccountInfo(mintAddress);
        const result = (info.value?.data as ParsedAccountData).parsed.info.decimals || 0;
        return result;
    } catch (error) {
        logger.error("getDecimals error");
        return null;
    }
}

/**
 * Retrieves all tokens with non-zero balance for a wallet
 * @param connection - Solana connection instance
 * @param owner - Owner's public key
 * @returns Array of token balances with metadata
 */
export const getAllTokensWithBalance = async (connection: Connection, owner: PublicKey) => {
    try {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
            programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        });
        // const token22Accounts = await connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") });

        const tokenBalances = [];

        for (const account of tokenAccounts.value) {
            const tokenAddress = account.account.data.parsed.info.mint;
            const balance = account.account.data.parsed.info.tokenAmount.uiAmount;
            if (balance === 0) continue;
            // Fetch metadata
            const metaData = await getTokenMetaData(connection, tokenAddress);

            tokenBalances.push({
                address: tokenAddress,
                symbol: metaData?.symbol || "Unknown",
                name: metaData?.name || "Unknown Token",
                balance: balance || 0,
                decimals: metaData?.decimals || 0,
            });
        }

        return tokenBalances;
    } catch (error) {
        logger.error("Error fetching wallet tokens:", error);
        return [];
    }
};

const MAX_RETRIES = 3;

/**
 * Submits and confirms a transaction with retries
 * @param transaction - Transaction to submit
 * @returns Confirmation status and signature
 */
export const submitAndConfirm = async (transaction: VersionedTransaction) => {
    try {
        const signature = await SOLANA_CONNECTION.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: MAX_RETRIES,
        });
        await confirmTransaction(SOLANA_CONNECTION, signature);

        return {
            confirmed: true,
            signature,
        };
    } catch (e) {
        logger.error("Error om submit:", { error: e });
        return {
            confirmed: false,
        };
    }
};

/**
 * Confirms a transaction with timeout and polling
 * @param connection - Solana connection instance
 * @param signature - Transaction signature
 * @param desiredConfirmationStatus - Desired confirmation status
 * @param timeout - Timeout in milliseconds
 * @param pollInterval - Polling interval in milliseconds
 * @param searchTransactionHistory - Whether to search transaction history
 * @returns Signature status
 */
const confirmTransaction = async (
    connection: Connection,
    signature: TransactionSignature,
    desiredConfirmationStatus: TransactionConfirmationStatus = "confirmed",
    timeout: number = 30000,
    pollInterval: number = 1000,
    searchTransactionHistory: boolean = false
): Promise<SignatureStatus> => {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const { value: statuses } = await connection.getSignatureStatuses([signature], { searchTransactionHistory });

        if (!statuses || statuses.length === 0) {
            throw new Error("Failed to get signature status");
        }

        const status = statuses[0];

        if (status === null) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            continue;
        }

        if (status.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }

        if (status.confirmationStatus && status.confirmationStatus === desiredConfirmationStatus) {
            return status;
        }

        if (status.confirmationStatus === "finalized") {
            return status;
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
};

/**
 * Sends native SOL to a destination address
 * @param chatId - User's chat ID
 * @param destination - Destination wallet address
 * @param amount - Amount to send
 * @param isPercentage - Whether amount is a percentage of balance
 * @returns Transaction confirmation status
 */
export const sendNativeSol = async (chatId: string, destination: string, amount: number, isPercentage: boolean) => {
    try {
        // Fetch the wallet associated with the chat ID
        const wallet = await getWalletByChatId(chatId);
        if (!wallet) throw new Error("Wallet not found for the given chat ID");

        // Decode the sender's private key
        const senderPrivateKey = wallet.privateKey;

        // Get the sender's balance
        const owner: Keypair = getKeypair(wallet!.privateKey);
        const senderPublicKey = new PublicKey(owner.publicKey);
        const balanceLamports = await SOLANA_CONNECTION.getBalance(senderPublicKey);

        // Calculate the amount to send in SOL
        let sendAmountSOL: number;
        if (isPercentage) {
            sendAmountSOL = (balanceLamports / LAMPORTS_PER_SOL) * (amount / 100); // Percentage-based calculation
        } else {
            sendAmountSOL = amount; // Fixed SOL amount
        }

        // Ensure the sender has enough balance
        if (sendAmountSOL * LAMPORTS_PER_SOL > balanceLamports) {
            throw new Error("Insufficient balance");
        }

        const signature = await sendSOL(senderPrivateKey, destination, sendAmountSOL);

        if (signature) {
            await confirmTransaction(SOLANA_CONNECTION, signature);
            logger.info("Withdrawal successful. TX Signature: ", { signature });
            return { confirmed: true, txSignature: signature };
        } else {
            logger.error("Withdrawal failed.");
            return { confirmed: false };
        }
    } catch (error: unknown) {
        logger.error("withdrawSOL Error: ", { error: getErrorMessage(error) });
        return { confirmed: false, error: getErrorMessage(error) };
    }
};

/**
 * Validates if a public key exists on Solana
 * @param connection - Solana connection instance
 * @param publicKeyString - Public key to validate
 * @returns Boolean indicating if public key is valid
 */
export const isValidPublicKey = async (connection: Connection, publicKeyString: string): Promise<boolean> => {
    try {
        // Validate the format of the public key
        const publicKey = new PublicKey(publicKeyString);

        // Check if the account exists on the blockchain
        const accountInfo = await connection.getAccountInfo(publicKey);
        return accountInfo !== null; // If accountInfo is not null, the public key is valid
    } catch (error) {
        logger.error("Invalid public key:", { error });
        return false; // Return false if the public key is invalid or does not exist
    }
};
