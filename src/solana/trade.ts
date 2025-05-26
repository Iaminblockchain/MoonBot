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
import { JUPYTER_BASE_URL } from "../util/constants";
import { getErrorMessage } from "../util/error";
import { calculateIntervals, createTimingMetrics } from "./timecalc";

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

export const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
export const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const LAMPORTS = LAMPORTS_PER_SOL;
const whitelistedUsers: string[] = require("../util/whitelistUsers.json");
const SOL_MINT = "So11111111111111111111111111111111111111112";
export const MIN_SOL_BALANCE = 0.005 * LAMPORTS_PER_SOL; // 0.005 SOL in lamports
// levels
// https://www.helius.dev/blog/solana-commitment-levels
// processed
// confirmed
// finalized

export const DEFAULT_CONFIRMATION_STATUS: TransactionConfirmationStatus = "confirmed";

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
    lookupTables: AddressLookupTableAccount[],
    useJito: boolean
): Promise<{
    confirmed: boolean;
    signature: string | null;
    error?: string;
}> {
    // Check balance before attempting transaction
    const balance = await connection.getBalance(payer.publicKey);
    const balanceInSol = balance / LAMPORTS_PER_SOL;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            logger.info(`TRADE sendWithRetries Current wallet balance: ${balanceInSol.toFixed(4)} SOL`);

            if (balance < MIN_SOL_BALANCE) {
                logger.error(`TRADE sendWithRetries Insufficient funds: Wallet has ${balanceInSol.toFixed(4)} SOL} SOL`);
                return {
                    confirmed: false,
                    signature: null,
                    error: `Insufficient funds: Wallet has ${balanceInSol.toFixed(4)} SOL, minimum required: ${(MIN_SOL_BALANCE / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
                };
            }

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

            // Get detailed error information if available
            if (signature) {
                const status = await connection.getSignatureStatus(signature);
                if (status.value?.err) {
                    let errorDetails = JSON.stringify(status.value.err);

                    // Check for insufficient funds error
                    if (
                        errorDetails.includes("InsufficientFunds") ||
                        errorDetails.includes("insufficient funds") ||
                        errorDetails.includes("0x1") ||
                        errorDetails.includes("Custom:1")
                    ) {
                        errorDetails = `Insufficient funds to complete the transaction. Current balance: ${balanceInSol.toFixed(4)} SOL`;
                    }

                    logger.error(`Transaction failed with error: ${errorDetails}`);
                    return { confirmed: false, signature, error: errorDetails };
                }
            } else {
                logger.error(`Transaction failed to confirm. No signature returned.`);
            }

            logger.info(`Attempt ${attempt} failed, retrying...`);
        } catch (error) {
            let errorMessage = error instanceof Error ? error.message : "Unknown error";

            // Check for insufficient funds in the error message
            if (
                errorMessage.includes("InsufficientFunds") ||
                errorMessage.includes("insufficient funds") ||
                errorMessage.includes("0x1") ||
                errorMessage.includes("Custom:1")
            ) {
                const balance = await connection.getBalance(payer.publicKey);
                const balanceInSol = balance / LAMPORTS_PER_SOL;
                errorMessage = `Insufficient funds to complete the transaction. Current balance: ${balanceInSol.toFixed(4)} SOL`;
            }

            logger.error(`Error in attempt ${attempt}: ${errorMessage}`);
            if (attempt === MAX_ATTEMPTS) {
                return { confirmed: false, signature: null, error: `Failed after ${MAX_ATTEMPTS} attempts: ${errorMessage}` };
            }
        }
    }

    return { confirmed: false, signature: null, error: "All attempts failed without specific error information" };
}

interface SwapResult {
    success: boolean;
    txSignature?: string | null;
    token_balance_change: number;
    sol_balance_change: number;
    execution_price: number;
    error?: string;
    executionInfo?: TransactionMetrics;
}

interface JupiterSwapResult {
    confirmed: boolean;
    txSignature: string | null;
    tokenAmount?: number;
    error?: string;
    executionInfo?: TransactionMetrics;
}

/**
 * Constructs the Jupiter quote URL with the given parameters
 * @param inputMint - Input token mint address
 * @param outputMint - Output token mint address
 * @param amount - Amount to swap
 * @param slippage - Slippage tolerance in basis points (defaults to 500 = 5%)
 * @param swapMode - "ExactIn" or "ExactOut" swap mode
 * @returns The complete Jupiter quote URL
 */
const constructJupiterQuoteUrl = (
    inputMint: string,
    outputMint: string,
    amount: number,
    slippage: number | undefined,
    swapMode: "ExactIn" | "ExactOut"
): string => {
    const baseUrl = `${JUPYTER_BASE_URL}/swap/v1/quote`;
    const DEFAULT_SLIPPAGE = 500; // 5% default slippage

    const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: Math.floor(amount).toString(),
        slippageBps: (slippage ?? DEFAULT_SLIPPAGE).toString(),
        swapMode,
    });

    return `${baseUrl}?${params.toString()}`;
};

export const buy_swap = async (
    CONNECTION: Connection,
    PRIVATE_KEY: string,
    tokenAddress: string,
    amount: number,
    slippage?: number
): Promise<SwapResult> => {
    const timingMetrics = createTimingMetrics();
    try {
        // Set priceCheckTime at the start
        timingMetrics.priceCheckTime = Date.now();

        // Check balance and get wallet info
        const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
        timingMetrics.walletFetchTime = Date.now();

        const balance = await CONNECTION.getBalance(keypair.publicKey);
        timingMetrics.balanceCheckTime = Date.now();

        const balanceInSol = balance / LAMPORTS_PER_SOL;
        logger.info(`TRADE: Current wallet balance before swap: ${balanceInSol.toFixed(4)} SOL`);

        if (balance < MIN_SOL_BALANCE) {
            const errorMsg = `Insufficient SOL balance: ${balanceInSol.toFixed(4)} SOL, minimum required: ${(MIN_SOL_BALANCE / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
            logger.error(errorMsg);
            return {
                success: false,
                token_balance_change: 0,
                sol_balance_change: 0,
                execution_price: 0,
                error: errorMsg,
            };
        }

        timingMetrics.swapStartTime = Date.now();
        const result = await jupiter_swap(CONNECTION, PRIVATE_KEY, WSOL_ADDRESS, tokenAddress, amount, "ExactIn", useJito, slippage);
        timingMetrics.swapEndTime = Date.now();

        if (result?.confirmed) {
            logger.info("execution info", { executionInfo: result.executionInfo });

            let token_balance_change = 0;
            let sol_balance_change = 0;
            let execution_price = 0;
            if (result.executionInfo) {
                token_balance_change = Number(result.executionInfo.token_balance_change);
                sol_balance_change = Number(result.executionInfo.sol_balance_change);
                execution_price = Number(result.executionInfo.execution_price);
            }

            // Get metadata for logging
            const metaData = await getTokenMetaData(CONNECTION, tokenAddress);
            timingMetrics.metadataFetchTime = Date.now();

            // Set final timestamps
            timingMetrics.messageSendTime = Date.now();
            timingMetrics.endTime = Date.now();

            // Calculate intervals once after all timestamps are set
            const timingIntervals = calculateIntervals(timingMetrics).intervals;

            // Use the same timingIntervals for all logging and response
            logger.info("Buy swap completed successfully", {
                token: metaData?.symbol,
                token_balance_change,
                sol_balance_change,
                execution_price,
                timing: timingIntervals,
            });

            logger.info("Buy transaction details", {
                status: "SUCCESS",
                token: metaData?.symbol,
                tokenAddress,
                amount: amount / LAMPORTS_PER_SOL,
                txSignature: result.txSignature,
                tokenBalanceChange: token_balance_change,
                solBalanceChange: sol_balance_change,
                executionPrice: execution_price,
                slippage: slippage ? `${slippage / 100}%` : "default",
                timing: timingIntervals,
            });

            return {
                success: true,
                txSignature: result.txSignature,
                token_balance_change: token_balance_change,
                sol_balance_change: sol_balance_change,
                execution_price: execution_price,
                executionInfo: {
                    owner_pubkey: keypair.publicKey.toString(),
                    token: tokenAddress,
                    token_balance_change: token_balance_change,
                    transaction_fee: result.executionInfo?.transaction_fee ?? 0,
                    sol_balance_change: sol_balance_change,
                    token_creation_cost: result.executionInfo?.token_creation_cost ?? 0,
                    feesPaid: result.executionInfo?.feesPaid ?? 0,
                    compute_units_consumed: result.executionInfo?.compute_units_consumed ?? null,
                    execution_price: execution_price,
                    timing: { intervals: timingIntervals },
                },
            };
        } else {
            // Get current balance for error message
            const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
            const balance = await CONNECTION.getBalance(keypair.publicKey);
            const balanceInSol = balance / LAMPORTS_PER_SOL;

            // Set final timestamps
            timingMetrics.messageSendTime = Date.now();
            timingMetrics.endTime = Date.now();

            // Calculate intervals once
            const timingIntervals = calculateIntervals(timingMetrics).intervals;

            logger.error("Buy transaction failed", {
                status: "FAILED",
                tokenAddress,
                amount: amount / LAMPORTS_PER_SOL,
                error: result?.error || "Unknown error",
                slippage: slippage ? `${slippage / 100}%` : "default",
                timing: timingIntervals,
            });

            return {
                success: false,
                token_balance_change: 0,
                sol_balance_change: 0,
                execution_price: 0,
                error: `${result?.error || "Swap failed to confirm"}\nCurrent balance: ${balanceInSol.toFixed(4)} SOL`,
            };
        }
    } catch (error) {
        // Set final timestamps
        timingMetrics.messageSendTime = Date.now();
        timingMetrics.endTime = Date.now();

        // Calculate intervals once
        const timingIntervals = calculateIntervals(timingMetrics).intervals;

        logger.error("Buy transaction error", {
            status: "ERROR",
            tokenAddress,
            amount: amount / LAMPORTS_PER_SOL,
            error: error instanceof Error ? error.message : "Unknown error",
            slippage: slippage ? `${slippage / 100}%` : "default",
            timing: timingIntervals,
        });
        throw error;
    }
};

export const sell_swap = async (
    CONNECTION: Connection,
    PRIVATE_KEY: string,
    tokenAddress: string,
    amount: number,
    slippage?: number
): Promise<SwapResult> => {
    const timingMetrics = createTimingMetrics();
    try {
        // Check balance before proceeding with sell
        const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
        timingMetrics.walletFetchTime = Date.now();

        const balance = await CONNECTION.getBalance(keypair.publicKey);
        timingMetrics.balanceCheckTime = Date.now();

        const balanceInSol = balance / LAMPORTS_PER_SOL;

        // For sells, we need to ensure enough SOL for fees
        // Fixed SOL fee
        const minfeeAmount = 0.005 * LAMPORTS_PER_SOL;
        const totalRequired = minfeeAmount;
        if (balance < totalRequired) {
            const errorMsg = `Insufficient SOL balance for fees: ${balanceInSol.toFixed(4)} SOL, required: ${(totalRequired / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
            logger.error(errorMsg);
            return {
                success: false,
                token_balance_change: 0,
                sol_balance_change: 0,
                execution_price: 0,
                error: errorMsg,
            };
        }

        timingMetrics.swapStartTime = Date.now();
        const result = await jupiter_swap(CONNECTION, PRIVATE_KEY, tokenAddress, WSOL_ADDRESS, amount, "ExactIn", useJito);
        timingMetrics.swapEndTime = Date.now();

        if (result?.confirmed) {
            logger.info("execution info", { executionInfo: result.executionInfo });

            let token_balance_change = 0;
            let sol_balance_change = 0;
            let execution_price = 0;
            if (result.executionInfo) {
                token_balance_change = Number(result.executionInfo.token_balance_change);
                sol_balance_change = Number(result.executionInfo.sol_balance_change);
                execution_price = Number(result.executionInfo.execution_price);
            }

            // Get metadata for logging
            const metaData = await getTokenMetaData(CONNECTION, tokenAddress);
            timingMetrics.metadataFetchTime = Date.now();

            logger.info("Sell swap completed successfully", {
                token: metaData?.symbol,
                token_balance_change,
                sol_balance_change,
                execution_price,
                timing: calculateIntervals(timingMetrics).intervals,
            });

            timingMetrics.messageSendTime = Date.now();
            timingMetrics.endTime = Date.now();

            return {
                success: true,
                txSignature: result.txSignature,
                token_balance_change: token_balance_change,
                sol_balance_change: sol_balance_change,
                execution_price: execution_price,
                executionInfo: {
                    owner_pubkey: keypair.publicKey.toString(),
                    token: tokenAddress,
                    token_balance_change: token_balance_change,
                    transaction_fee: result.executionInfo?.transaction_fee ?? 0,
                    sol_balance_change: sol_balance_change,
                    token_creation_cost: result.executionInfo?.token_creation_cost ?? 0,
                    feesPaid: result.executionInfo?.feesPaid ?? 0,
                    compute_units_consumed: result.executionInfo?.compute_units_consumed ?? null,
                    execution_price: execution_price,
                    timing: { intervals: calculateIntervals(timingMetrics).intervals },
                },
            };
        } else {
            // Get current balance for error message
            const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
            const balance = await CONNECTION.getBalance(keypair.publicKey);
            const balanceInSol = balance / LAMPORTS_PER_SOL;

            timingMetrics.endTime = Date.now();
            logger.error("Sell swap failed", {
                error: result?.error || "Swap failed to confirm",
                timing: calculateIntervals(timingMetrics).intervals,
            });

            return {
                success: false,
                token_balance_change: 0,
                sol_balance_change: 0,
                execution_price: 0,
                error: result?.error || `Swap failed to confirm. Current balance: ${balanceInSol.toFixed(4)} SOL`,
            };
        }
    } catch (error) {
        timingMetrics.endTime = Date.now();
        logger.error("Sell swap error", {
            error: error instanceof Error ? error.message : "Unknown error",
            timing: calculateIntervals(timingMetrics).intervals,
        });
        throw error;
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
): Promise<JupiterSwapResult> => {
    try {
        logger.info(`jupiter_swap ${inputMint} ${outputMint} ${amount} ${swapMode}`);
        const feePayer = new PublicKey(FEE_COLLECTION_WALLET);
        const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

        // Check balance before proceeding
        const balance = await CONNECTION.getBalance(keypair.publicKey);
        const balanceInSol = balance / LAMPORTS_PER_SOL;
        logger.info(`TRADE: Current wallet balance before swap: ${balanceInSol.toFixed(4)} SOL`);

        if (balance < MIN_SOL_BALANCE) {
            const errorMsg = `Insufficient SOL balance: ${balanceInSol.toFixed(4)} SOL, minimum required: ${(MIN_SOL_BALANCE / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
            logger.error(errorMsg);
            return { confirmed: false, txSignature: null, tokenAmount: 0, error: errorMsg };
        }

        const quoteUrl = constructJupiterQuoteUrl(inputMint, outputMint, amount, slippage, swapMode);
        logger.info(`TRADE Fetching quote from Jupiter: ${inputMint}`, quoteUrl);

        const quoteResponse = await fetch(quoteUrl);
        if (!quoteResponse.ok) {
            const text = await quoteResponse.text();
            let errlog = `Quote API error (${quoteResponse.status}): ${text}`;
            logger.error(errlog);
            return { confirmed: false, txSignature: null, tokenAmount: 0, error: errlog };
        }
        const quoteData = await quoteResponse.json();
        if (quoteData.error) {
            let errlog = `Quote error: ${quoteData.error}`;
            logger.error(errlog);
            return { confirmed: false, txSignature: null, tokenAmount: 0, error: errlog };
        }
        logger.info(`TRADE Quote response received ${quoteData}`);

        // Get token decimals from metadata
        const tokenMetaData = await getTokenMetaData(CONNECTION, outputMint);
        if (!tokenMetaData?.decimals) {
            const errlog = "Failed to get token decimals";
            logger.error(errlog, { outputMint });
            return { confirmed: false, txSignature: null, tokenAmount: 0, error: errlog };
        }
        logger.info(`TRADE tokenMetaData ${tokenMetaData}`);

        // Get raw token amount from quote response
        const tokenAmount = parseInt(quoteData.outAmount);
        logger.info("Raw token amount:", tokenAmount);

        let feeAmount =
            inputMint === WSOL_ADDRESS ? Math.floor(parseInt(quoteData.inAmount) / 100) : Math.floor(parseInt(quoteData.outAmount) / 100);
        logger.info("Calculated feeAmount:", feeAmount);

        const chatId = await getChatIdByPrivateKey(PRIVATE_KEY);
        logger.info(`TRADE getswapinstructions`);
        const { instructions, addressLookupTableAccounts } = await getSwapInstructions(quoteData, keypair.publicKey.toBase58());

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

        logger.info(`TRADE sendWithRetries`);
        const result = await sendWithRetries(CONNECTION, keypair, instructions, addressLookupTableAccounts, isJito);

        if (!result.confirmed) {
            const errorMsg = result.error || "Swap failed to confirm";
            logger.error(errorMsg, {
                balance: balanceInSol.toFixed(4),
                //required: (totalRequired / LAMPORTS_PER_SOL).toFixed(4),
                slippage: `${slippage / 100}%`,
            });
            return { confirmed: false, txSignature: null, tokenAmount: 0, error: errorMsg };
        }

        // Return immediately with signature if we have one
        if (result.signature) {
            // Start confirmation process in background
            (async () => {
                try {
                    // execution info, distinguish between SOL and token
                    const tokenMint = inputMint === SOL_MINT ? outputMint : inputMint;
                    let executionInfo = await getTxInfoMetrics(result.signature!, CONNECTION, tokenMint);
                    if (executionInfo) {
                        logger.info("Execution info", executionInfo);
                    }
                    const status = await getStatusTxnRetry(CONNECTION, result.signature!);
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
                    } else {
                        logger.error("Txn failed after retry:", status);
                    }
                } catch (error) {
                    logger.error("Error in background confirmation:", error);
                }
            })();

            return { confirmed: true, txSignature: result.signature };
        } else {
            logger.error("TRADE unknown state no signature");
            return { confirmed: false, txSignature: null, tokenAmount: 0, error: "No signature received" };
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error occurred";
        logger.error(`TRADE jupiter swap error: ${errorMsg}`, {
            error: errorMsg,
            inputMint,
            outputMint,
            amount: amount / LAMPORTS_PER_SOL,
            swapMode,
        });
        return { confirmed: false, txSignature: null, tokenAmount: 0, error: errorMsg };
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
        logger.info(`TRADE submitAndConfirm`);
        const signature = await SOLANA_CONNECTION.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: MAX_RETRIES,
        });
        logger.info(`TRADE signature ${signature}`);

        try {
            await confirmTransaction(SOLANA_CONNECTION, signature);
            return {
                confirmed: true,
                signature,
            };
        } catch (confirmError) {
            // Get detailed error information
            const status = await SOLANA_CONNECTION.getSignatureStatus(signature);
            let errorDetails = status.value?.err ? JSON.stringify(status.value.err) : "Unknown confirmation error";

            // Check for insufficient funds error
            if (errorDetails.includes("InsufficientFunds") || errorDetails.includes("insufficient funds")) {
                errorDetails = "Insufficient funds to complete the transaction";
            }

            logger.error(`Transaction confirmation failed: ${errorDetails}`);
            return {
                confirmed: false,
                signature,
                error: `Transaction confirmation failed: ${errorDetails}`,
            };
        }
    } catch (e) {
        let errorMessage = e instanceof Error ? e.message : "Unknown error";

        // Check for insufficient funds in the error message
        if (errorMessage.includes("InsufficientFunds") || errorMessage.includes("insufficient funds") || errorMessage.includes("0x1")) {
            // 0x1 is the error code for insufficient funds
            errorMessage = "Insufficient funds to complete the transaction";
        }

        logger.error(`Error on submit: ${errorMessage}`, { error: e });
        return {
            confirmed: false,
            signature: null,
            error: `Transaction submission failed: ${errorMessage}`,
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
    desiredConfirmationStatus: TransactionConfirmationStatus = DEFAULT_CONFIRMATION_STATUS,
    timeout: number = 20000,
    pollInterval: number = 2000,
    searchTransactionHistory: boolean = true
): Promise<SignatureStatus> => {
    const start = Date.now();
    logger.info(`Starting transaction confirmation for signature: ${signature}`, {
        desiredStatus: desiredConfirmationStatus,
        timeout,
        pollInterval,
    });

    while (Date.now() - start < timeout) {
        try {
            const { value: statuses } = await connection.getSignatureStatuses([signature], { searchTransactionHistory });
            logger.info(`Transaction status check: ${signature}`, {
                signature,
                statuses,
                elapsedTime: Date.now() - start,
            });

            if (!statuses || statuses.length === 0) {
                logger.warn(`No status found for signature ${signature}, retrying...`);
                await new Promise((resolve) => setTimeout(resolve, pollInterval));
                continue;
            }

            const status = statuses[0];

            if (status === null) {
                logger.debug(`Status is null for signature ${signature}, waiting for confirmation...`);
                await new Promise((resolve) => setTimeout(resolve, pollInterval));
                continue;
            }

            //Transfer: insufficient lamports 1161504, need 2039280
            //Program returned error: custom program error: 0x1

            if (status.err) {
                const errorDetails = JSON.stringify(status.err);
                logger.error(`Transaction failed with error:`, {
                    signature,
                    error: errorDetails,
                    confirmationStatus: status.confirmationStatus,
                });
                throw new Error(`Transaction failed: ${errorDetails}`);
            }

            if (status.confirmationStatus && status.confirmationStatus === desiredConfirmationStatus) {
                logger.info(`Transaction confirmed with status ${status.confirmationStatus}:`, {
                    signature,
                    confirmationStatus: status.confirmationStatus,
                    elapsedTime: Date.now() - start,
                });
                return status;
            }

            if (status.confirmationStatus === DEFAULT_CONFIRMATION_STATUS) {
                logger.info(`Transaction confirmed status ${status.confirmationStatus}:`, {
                    signature,
                    confirmationStatus: status.confirmationStatus,
                    elapsedTime: Date.now() - start,
                });
                return status;
            }

            logger.debug(`Waiting for confirmation, current status: ${status.confirmationStatus}`);
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
        } catch (error) {
            logger.error(`Error checking transaction status:`, {
                signature,
                error: error instanceof Error ? error.message : String(error),
                elapsedTime: Date.now() - start,
            });
            throw error;
        }
    }

    const error = `Transaction confirmation timeout after ${timeout}ms`;
    logger.error(error, {
        signature,
        elapsedTime: Date.now() - start,
        desiredStatus: desiredConfirmationStatus,
    });
    throw new Error(error);
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

/**
 * Executes a swap operation with retries and timeout
 * @param connection - Solana connection instance
 * @param privateKey - User's private key
 * @param tokenAddress - Token address to swap
 * @param amount - Amount to swap
 * @param isBuy - Whether this is a buy operation (true) or sell operation (false)
 * @param slippage - Optional slippage tolerance
 * @returns Swap result with transaction details
 */
export const executeSwapWithRetry = async (
    connection: Connection,
    privateKey: string,
    tokenAddress: string,
    amount: number,
    isBuy: boolean,
    slippage?: number
): Promise<SwapResult> => {
    const MAX_RETRIES = 3;
    const MAX_RETRY_TIMEOUT = 20000; // 20 seconds total timeout for retries
    let retryCount = 0;
    const startTime = Date.now();
    let lastError: string | null = null;

    // Check SOL balance before proceeding
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const solBalance = await connection.getBalance(keypair.publicKey);
    const solBalanceInSol = solBalance / LAMPORTS_PER_SOL;
    const MIN_SOL_BALANCE = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL in lamports

    logger.info(`Checking wallet balance for swap operation: ${solBalanceInSol.toFixed(4)} SOL`);

    if (solBalance < MIN_SOL_BALANCE) {
        const errorMsg = `Insufficient SOL balance for swap operation. Required: 0.01 SOL, Current: ${solBalanceInSol.toFixed(4)} SOL`;
        logger.warn(errorMsg);
        return {
            success: false,
            token_balance_change: 0,
            sol_balance_change: 0,
            execution_price: 0,
            error: errorMsg,
        };
    }

    while (retryCount < MAX_RETRIES) {
        try {
            const swapResult = isBuy
                ? await buy_swap(connection, privateKey, tokenAddress, amount, slippage)
                : await sell_swap(connection, privateKey, tokenAddress, amount, slippage);

            if (swapResult.success) {
                return swapResult;
            }

            // Store the error message from the failed attempt
            lastError = swapResult.error || "Unknown error occurred";

            // Check if we've exceeded the total timeout
            if (Date.now() - startTime > MAX_RETRY_TIMEOUT) {
                logger.warn(`Swap operation timed out after ${retryCount} retries for ${tokenAddress}`);
                return {
                    success: false,
                    token_balance_change: 0,
                    sol_balance_change: 0,
                    execution_price: 0,
                    error: `Swap operation timed out after ${retryCount} retries. Last error: ${lastError}`,
                };
            }

            retryCount++;
            if (retryCount < MAX_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
            }
        } catch (error) {
            lastError = error instanceof Error ? error.message : "Unknown error occurred";
            logger.error(`Error in swap attempt ${retryCount + 1} for ${tokenAddress}:`, error);
            retryCount++;
            if (retryCount >= MAX_RETRIES || Date.now() - startTime > MAX_RETRY_TIMEOUT) {
                return {
                    success: false,
                    token_balance_change: 0,
                    sol_balance_change: 0,
                    execution_price: 0,
                    error: `Failed after ${retryCount} attempts. Last error: ${lastError}`,
                };
            }
            await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
        }
    }

    return {
        success: false,
        token_balance_change: 0,
        sol_balance_change: 0,
        execution_price: 0,
        error: `All ${MAX_RETRIES} swap attempts failed. Last error: ${lastError}`,
    };
};
