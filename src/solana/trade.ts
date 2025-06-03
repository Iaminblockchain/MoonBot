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
    TransactionSignature,
    TransactionConfirmationStatus,
    AddressLookupTableAccount,
    TransactionInstruction,
} from "@solana/web3.js";
import { FEE_COLLECTION_WALLET, SOLANA_CONNECTION } from "..";
import { getChatIdByPrivateKey, getWalletByChatId, getReferralWallet } from "../models/walletModel";
import { getKeypair } from "./util";
import { logger } from "../logger";
import { getTokenMetaData } from "./token";
import { getStatusTxnRetry, getTxInfoMetrics } from "./txhelpers";
import { getReferralByRefereeId, updateRewards } from "../models/referralModel";
import { JUPYTER_BASE_URL } from "../util/constants";
import { createTimingMetrics } from "./timecalc";
import { getSOLpriceUSD } from "./getPrice";

export const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
export const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const LAMPORTS = LAMPORTS_PER_SOL;
const whitelistedUsers: string[] = require("../util/whitelistUsers.json");
const SOL_MINT = "So11111111111111111111111111111111111111112";
const MAX_RETRIES = 3;

//finalized slower
const DEFAULT_CONFIRMATION_STATUS = "confirmed";
const DEFAULT_TIMEOUT = 20000;
const DEFAULT_POLL_INTERVAL = 2000;

import { getErrorMessage } from "../util/error";

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
    let url = `${JUPYTER_BASE_URL}/swap/v1/swap-instructions`;
    const res = await fetch(url, {
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
    lookupTables: AddressLookupTableAccount[]
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

        const raw = await submitAndConfirm(tx);

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
    execution_price_usd: number;
    feesPaid: number;
    error?: string;
    timingMetrics?: {
        intervals: {
            priceCheckDuration: number;
            walletFetchDuration: number;
            balanceCheckDuration: number;
            swapDuration: number;
            metadataFetchDuration: number;
            messageSendDuration: number;
            totalDuration: number;
        };
    };
}

export const buy_swap = async (
    CONNECTION: Connection,
    PRIVATE_KEY: string,
    tokenAddress: string,
    amount: number,
    slippage?: number
): Promise<SwapResult> => {
    const timingMetrics = createTimingMetrics();
    timingMetrics.startTime = Date.now();

    const result = await jupiter_swap(CONNECTION, PRIVATE_KEY, WSOL_ADDRESS, tokenAddress, amount, "ExactIn", slippage);
    timingMetrics.swapEndTime = Date.now();

    if (result && result.confirmed) {
        timingMetrics.priceCheckTime = Date.now();
        logger.info("execution info", { executionInfo: result.executionInfo });

        let token_balance_change = 0;
        let sol_balance_change = 0;
        let execution_price = 0;
        let feesPaid = 0;
        let solPriceUSD = 0;

        if (result.executionInfo) {
            token_balance_change = Number(result.executionInfo.token_balance_change);
            sol_balance_change = Number(result.executionInfo.sol_balance_change);
            execution_price = Number(result.executionInfo.execution_price);
            feesPaid = Number(result.executionInfo.feesPaid);
        }

        // Get SOL price in USD
        try {
            solPriceUSD = await getSOLpriceUSD();
            logger.info("SOL price in USD:", { solPriceUSD });
        } catch (error) {
            logger.error("Error fetching SOL price:", error);
            // Continue execution even if price fetch fails
        }

        let execution_price_usd = execution_price * solPriceUSD;

        timingMetrics.endTime = Date.now();
        const finalMetrics = {
            intervals: {
                priceCheckDuration: timingMetrics.priceCheckTime - timingMetrics.swapEndTime,
                swapDuration: timingMetrics.swapEndTime - timingMetrics.startTime,
                balanceCheckDuration: 0,
                walletFetchDuration: 0,
                metadataFetchDuration: 0,
                messageSendDuration: 0,
                totalDuration: timingMetrics.endTime - timingMetrics.startTime,
            },
        };
        logger.info("Buy swap timing metrics", { metrics: finalMetrics });

        return {
            success: true,
            txSignature: result.txSignature,
            token_balance_change: token_balance_change,
            sol_balance_change: sol_balance_change,
            execution_price: execution_price,
            execution_price_usd: execution_price_usd,
            feesPaid: feesPaid,
            timingMetrics: finalMetrics,
        };
    }

    timingMetrics.endTime = Date.now();
    const finalMetrics = {
        intervals: {
            priceCheckDuration: 0,
            swapDuration: timingMetrics.swapEndTime - timingMetrics.startTime,
            balanceCheckDuration: 0,
            walletFetchDuration: 0,
            metadataFetchDuration: 0,
            messageSendDuration: 0,
            totalDuration: timingMetrics.endTime - timingMetrics.startTime,
        },
    };
    logger.info("Buy swap timing metrics (failed)", { metrics: finalMetrics });

    return {
        success: false,
        token_balance_change: 0,
        sol_balance_change: 0,
        execution_price: 0,
        execution_price_usd: 0,
        feesPaid: 0,
        error: "Transaction failed",
        timingMetrics: finalMetrics,
    };
};

export const sell_swap = async (
    CONNECTION: Connection,
    PRIVATE_KEY: string,
    tokenAddress: string,
    amount: number,
    slippage?: number
): Promise<SwapResult> => {
    const startTime = Date.now();
    const timingMetrics = createTimingMetrics();
    timingMetrics.startTime = startTime;

    const result = await jupiter_swap(CONNECTION, PRIVATE_KEY, tokenAddress, WSOL_ADDRESS, amount, "ExactIn");
    const swapEndTime = Date.now();
    timingMetrics.swapEndTime = swapEndTime;

    if (result && result.confirmed) {
        const priceCheckTime = Date.now();
        timingMetrics.priceCheckTime = priceCheckTime;
        logger.info(`confirmed ${tokenAddress} execution info`, { executionInfo: result.executionInfo });

        let token_balance_change = 0;
        let sol_balance_change = 0;
        let execution_price = 0;
        let feesPaid = 0;
        if (result.executionInfo) {
            token_balance_change = Number(result.executionInfo.token_balance_change);
            sol_balance_change = Number(result.executionInfo.sol_balance_change);
            execution_price = Number(result.executionInfo.execution_price);
            feesPaid = Number(result.executionInfo.feesPaid);
        }

        // Get SOL price in USD
        let solPriceUSD = 0;
        try {
            solPriceUSD = await getSOLpriceUSD();
            logger.info("SOL price in USD:", { solPriceUSD });
        } catch (error) {
            logger.error("Error fetching SOL price:", error);
            // Continue execution even if price fetch fails
        }

        let execution_price_usd = execution_price * solPriceUSD;

        const endTime = Date.now();
        timingMetrics.endTime = endTime;

        const finalMetrics = {
            intervals: {
                priceCheckDuration: priceCheckTime - swapEndTime,
                swapDuration: swapEndTime - startTime,
                balanceCheckDuration: 0,
                walletFetchDuration: 0,
                metadataFetchDuration: 0,
                messageSendDuration: 0,
                totalDuration: endTime - startTime,
                txSubmitDuration: result.executionInfo?.txSubmitDuration || 0,
                txConfirmDuration: result.executionInfo?.txConfirmDuration || 0,
            },
        };
        logger.info("Sell swap timing metrics", { metrics: finalMetrics });

        return {
            success: true,
            txSignature: result.txSignature,
            token_balance_change: token_balance_change,
            sol_balance_change: sol_balance_change,
            execution_price: execution_price,
            execution_price_usd: execution_price_usd,
            feesPaid: feesPaid,
            timingMetrics: finalMetrics,
        };
    } else {
        logger.error(`sell_swap failed to confirm ${tokenAddress}`, { result });

        const endTime = Date.now();
        timingMetrics.endTime = endTime;

        const finalMetrics = {
            intervals: {
                priceCheckDuration: 0,
                swapDuration: swapEndTime - startTime,
                balanceCheckDuration: 0,
                walletFetchDuration: 0,
                metadataFetchDuration: 0,
                messageSendDuration: 0,
                totalDuration: endTime - startTime,
                txSubmitDuration: result.executionInfo?.txSubmitDuration || 0,
                txConfirmDuration: result.executionInfo?.txConfirmDuration || 0,
            },
        };
        logger.info("Sell swap timing metrics (failed)", { metrics: finalMetrics });

        return {
            success: false,
            token_balance_change: 0,
            sol_balance_change: 0,
            execution_price: 0,
            execution_price_usd: 0,
            feesPaid: 0,
            error: "Swap failed to confirm",
            timingMetrics: finalMetrics,
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
    slippage: number = 500
) => {
    try {
        logger.info(`JUPYTERSWAP SLIPPAGE: ${slippage} ${inputMint} ${outputMint} ${amount} ${swapMode}`);
        const feePayer = new PublicKey(FEE_COLLECTION_WALLET);
        const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
        let baseUrl = `${JUPYTER_BASE_URL}/swap/v1/quote`;
        const quoteUrl =
            baseUrl +
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

        const submitStartTime = Date.now();
        const result = await sendWithRetries(CONNECTION, keypair, instructions, addressLookupTableAccounts);
        const submitEndTime = Date.now();
        const txSubmitDuration = submitEndTime - submitStartTime;

        if (!result || !result.confirmed) {
            logger.error("All attempts failed");
            return { confirmed: false, txSignature: null, tokenAmount: 0 };
        }

        // After retry, check if confirmed and validate with getStatusTxnRetry
        if (result.signature) {
            const confirmStartTime = Date.now();
            // execution info, distinguish between SOL and token
            const tokenMint = inputMint === SOL_MINT ? outputMint : inputMint;
            //TODO! double check we should get status first
            let executionInfo = await getTxInfoMetrics(result.signature, CONNECTION, tokenMint);
            if (executionInfo) {
                logger.info("Execution info", executionInfo);
            }
            const status = await getStatusTxnRetry(CONNECTION, result.signature);
            const confirmEndTime = Date.now();
            const txConfirmDuration = confirmEndTime - confirmStartTime;

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
                return {
                    confirmed: true,
                    txSignature: result.signature,
                    executionInfo: {
                        ...executionInfo,
                        txSubmitDuration,
                        txConfirmDuration,
                    },
                };
            } else {
                logger.error("Txn failed after retry:", status);
                return { confirmed: false, txSignature: result.signature, tokenAmount: 0 };
            }
        } else {
            logger.error("unknown state no signature");
            return { confirmed: false, txSignature: null, tokenAmount: 0 };
        }
    } catch (error) {
        logger.error("jupiter swap:", { error });
        logger.error(`Input Mint: ${inputMint}`);
        logger.error(`Output Mint: ${outputMint}`);
        logger.error(`Amount: ${amount}`);
        logger.error(`Swap Mode: ${swapMode}`);
        logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        return { confirmed: false, txSignature: null, tokenAmount: 0 };
    }
};

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
        logger.info(`submitAndConfirm signature: ${signature}`);
        let result = await confirmTransaction(SOLANA_CONNECTION, signature);

        return {
            confirmed: result.confirmed,
            signature,
        };
    } catch (e) {
        logger.error("Error om submit:", { error: e });
        return {
            confirmed: false,
        };
    }
};

const sleep = (ms: number) => {
    const start = Date.now();
    while (Date.now() - start < ms) {}
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
    desiredConfirmationStatus: TransactionConfirmationStatus = DEFAULT_CONFIRMATION_STATUS,
    timeout: number = DEFAULT_TIMEOUT,
    pollInterval: number = DEFAULT_POLL_INTERVAL,
    searchTransactionHistory: boolean = false
): Promise<{ confirmed: boolean }> => {
    const start = Date.now();
    logger.info(`confirmTransaction ${signature} ${desiredConfirmationStatus} ${timeout} ${pollInterval} ${searchTransactionHistory}`);

    while (Date.now() - start < timeout) {
        const { value: statuses } = await connection.getSignatureStatuses([signature], { searchTransactionHistory });
        const status = statuses[0];
        logger.info(`confirmTransaction statuses: ${statuses} ${status?.confirmationStatus}`);

        if (status === null) {
            sleep(pollInterval);
            continue;
        }

        if (status.err) {
            return { confirmed: false };
        }

        if (status.confirmationStatus === desiredConfirmationStatus) {
            return { confirmed: true };
        }

        sleep(pollInterval);
    }

    logger.info(`confirmTransaction  ${signature} failed. timed out`);

    return { confirmed: false };
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
