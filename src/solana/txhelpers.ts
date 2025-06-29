// tx-helpers.ts
import { Connection, ParsedTransactionWithMeta, PublicKey, SignatureStatus, TransactionSignature, TokenBalance } from "@solana/web3.js";
import { logger } from "../logger";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { WSOL_ADDRESS } from "./trade";
import { getTokenPriceUSD } from "./getPrice";
import { betterConsoleLog } from "telegram/Helpers";

// Define commitment level constant
export const COMMITMENT_LEVEL = "confirmed";

/*   error codes & texts  */
export const ERR_1001 = "Unknown instruction error";
export const ERR_1002 = "Provided owner is not allowed";
export const ERR_1003 = "custom program error: insufficient funds";
export const ERR_1011 = "Not known Error";

export const ERR_6002 = "slippage: Too much SOL required to buy the given amount of tokens.";
export const ERR_6003 = "slippage: Too little SOL received to sell the given amount of tokens.";

/*  helpers  */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getTokenBalance = (tokenBalances: TokenBalance[], mint: string, owner: string): number => {
    for (const t of tokenBalances) {
        if (t?.mint === mint && t?.owner === owner) {
            return Number(t.uiTokenAmount?.uiAmount ?? 0);
        }
    }
    return 0;
};

interface InstructionErrorDetail {
    Custom?: number;
    [key: string]: unknown;
}

// status poller
export async function getStatusTxnRetry(
    connection: Connection,
    txsig: string,
    maxRetries = 20,
    retrySleep = 500
): Promise<{ success: true; txsig: string } | { success: false; error: string; errorcode: number }> {
    logger.info(`try get_status_txn ${txsig} (max ${maxRetries}, every ${retrySleep} ms)`);

    for (let retry = 0; retry < maxRetries; retry++) {
        try {
            const { value } = await connection.getSignatureStatuses([txsig], { searchTransactionHistory: true });
            const status = value[0] as SignatureStatus | null;

            if (!status) {
                await sleep(retrySleep);
                continue; // not found yet
            }
            if (status.err == null) {
                logger.info(`Transaction confirmed ${txsig}`);
                return { success: true, txsig };
            }

            /*  decode InstructionError  */
            const err = status.err as { InstructionError?: [number, InstructionErrorDetail | string] };
            if (err?.InstructionError) {
                const [, detail] = err.InstructionError;

                if (typeof detail === "string" && detail === "IllegalOwner") {
                    return { success: false, error: ERR_1002, errorcode: 1002 };
                }

                if (typeof detail === "object" && "Custom" in detail) {
                    switch (detail.Custom) {
                        case 1:
                            return { success: false, error: ERR_1003, errorcode: 1003 };
                        case 6002:
                            return { success: false, error: ERR_6002, errorcode: 6002 };
                        case 6003:
                            return { success: false, error: ERR_6003, errorcode: 6003 };
                        default:
                            return { success: false, error: ERR_1001, errorcode: 1001 };
                    }
                }

                return { success: false, error: ERR_1011, errorcode: 1011 };
            }

            /*  any other error  */
            logger.error(`Unexpected tx error`, { err, txsig });
            return { success: false, error: ERR_1001, errorcode: 1001 };
        } catch (e) {
            logger.error(`confirmation attempt ${retry}: ${String(e)}`);
            await sleep(retrySleep);
        }
    }
    logger.error(`Max retries reached. Tx confirmation failed ${txsig}`);
    return { success: false, error: "could not confirm in time", errorcode: 1003 };
}

export async function getTx(url: string, txsig: string) {
    const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
            txsig,
            {
                commitment: COMMITMENT_LEVEL,
                maxSupportedTransactionVersion: 0,
                encoding: "json",
            },
        ],
    });

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.result;
    } catch (error) {
        logger.error(`Error fetching transaction: ${error}`);
        return null;
    }
}

interface Transaction {
    transaction?: {
        message: {
            accountKeys: string[];
        };
    };
    meta?: {
        preBalances: number[];
        postBalances: number[];
        fee: number;
        computeUnitsConsumed?: number;
        preTokenBalances: TokenBalance[];
        postTokenBalances: TokenBalance[];
    };
}

// get tx info
export async function getTxInfo(txsig: string, connection: Connection, tokenMint: string): Promise<Transaction | null> {
    const maxRetries = 20;
    for (let retry = 0; retry < maxRetries; retry++) {
        try {
            const txn = await connection.getTransaction(txsig, {
                commitment: COMMITMENT_LEVEL,
                maxSupportedTransactionVersion: 0,
            });
            if (txn) {
                // make it plain JSON – easier to work with & log
                const plain = JSON.parse(JSON.stringify(txn)) as Transaction;
                return plain;
            }
            await sleep(1000);
        } catch (e) {
            logger.error(`getTxInfo retry ${retry} – ${String(e)}`);
            await sleep(1000);
        }
    }
    logger.error(`No tx info after ${maxRetries} retries – ${txsig}`);
    return null;
}

//  get tx info + metrics
export async function getTxInfoMetrics(txsig: string, connection: Connection, tokenMint: string) {
    const tx = await getTxInfo(txsig, connection, tokenMint);
    if (!tx) {
        logger.warn(`no tx info for ${tokenMint}`);
        return;
    }
    const metrics = extractTransactionMetrics(tx, tokenMint);
    return { ...metrics };
}

export type TransactionMetrics = {
    owner_pubkey: string;
    token: string;
    token_balance_change: number;
    //SOL fee
    transaction_fee: number;
    sol_balance_change: number;
    token_creation_cost: number;
    execution_price: number;
    //DEX fees
    feesPaid: number;
    compute_units_consumed: number | null;
};

export function extractTransactionMetrics(tx: Transaction, tokenMint: string): TransactionMetrics | null {
    const message = tx.transaction?.message;
    if (!message) {
        return null;
    }

    const accountKeys: string[] = message.accountKeys || [];

    const meta = tx.meta ?? {
        preBalances: [],
        postBalances: [],
        fee: 0,
        preTokenBalances: [],
        postTokenBalances: [],
    };

    const preBalances: number[] = meta.preBalances;
    const postBalances: number[] = meta.postBalances;
    const fee: number = meta.fee;
    const computeUnits = meta.computeUnitsConsumed ?? null;

    const preTokenBalances = meta.preTokenBalances || [];
    const postTokenBalances = meta.postTokenBalances || [];

    const ownerPubkey =
        postTokenBalances.find((b) => b.mint === tokenMint)?.owner || preTokenBalances.find((b) => b.mint === tokenMint)?.owner || "";

    const preToken = getTokenBalance(preTokenBalances, tokenMint, ownerPubkey);
    const postToken = getTokenBalance(postTokenBalances, tokenMint, ownerPubkey);
    logger.info(`preToken ${tokenMint}: ${preToken}  ${ownerPubkey} ${JSON.stringify(preTokenBalances)}`);
    logger.info(`postToken ${tokenMint}: ${postToken}  ${ownerPubkey} ${JSON.stringify(postTokenBalances)}`);
    const tokenBalanceChange = postToken - preToken;
    const absoluteTokenBalanceChange = Math.abs(tokenBalanceChange);
    logger.info(`tokenBalanceChange ${tokenBalanceChange}`);
    logger.info(`absoluteTokenBalanceChange ${absoluteTokenBalanceChange}`);

    /* SOL spent (lamports SOL) */
    let solBalanceChange = 0;
    if (preBalances.length && postBalances.length) {
        solBalanceChange = Math.abs(preBalances[0] - postBalances[0]) / 1e9;
    }

    /* rent paid for creating a new token account (optional) */
    let tokenCreationCost = 0;
    for (let i = 0; i < postBalances.length; i++) {
        if (preBalances[i] === 0 && postBalances[i] > 0) {
            tokenCreationCost = postBalances[i] / 1e9;
            break;
        }
    }

    //calcualte fees

    // total SOL movement of signer (index 0)
    // <0 for buy, >0 for sell
    const totalSolChange = (postBalances[0] - preBalances[0]) / 1e9;
    const isSell = totalSolChange > 0;

    // ── find the pool transfer
    // SOL amount that actually swaps against tokens
    let solTransferredWithPool = 0;

    for (let i = 1; i < preBalances.length; i++) {
        const delta = (postBalances[i] - preBalances[i]) / 1e9;

        if (isSell) {
            // pool sends SOL out most-negative delta
            if (delta < solTransferredWithPool) solTransferredWithPool = delta;
        } else {
            // pool receives SOL largest positive delta
            if (delta > solTransferredWithPool) solTransferredWithPool = delta;
        }
    }

    // ── network / aggregator fee in SOL
    const actualFee = isSell
        ? totalSolChange - Math.abs(solTransferredWithPool) // sell
        : -totalSolChange - Math.abs(solTransferredWithPool); // buy

    // ── execution price (SOL per token)
    const effectiveSolAmount = Math.abs(solTransferredWithPool);
    const executionPrice = absoluteTokenBalanceChange > 0 ? effectiveSolAmount / absoluteTokenBalanceChange : 0;

    logger.info(`preBalances ${preBalances}`);
    logger.info(`postBalances ${postBalances}`);
    logger.info(`solTransferredWithPool ${solTransferredWithPool}`);
    logger.info(`executionPrice ${executionPrice}`);
    logger.info(`actualFee ${actualFee}`);

    return {
        owner_pubkey: ownerPubkey,
        token: tokenMint,
        token_balance_change: tokenBalanceChange,
        transaction_fee: fee,
        sol_balance_change: effectiveSolAmount,
        token_creation_cost: tokenCreationCost,
        feesPaid: actualFee,
        compute_units_consumed: computeUnits,
        execution_price: executionPrice,
    };
}

interface TransactionResult {
    signature: string;
    tokenAmount: number | null;
    tokenSolPrice: number | null;
    tokenUsdPrice: number | null;
    transactionFee: number | null;
    netBuySolAmount: number | null;
    executionPrice: number | null;
    error?: string;
}

// Function to fetch and parse transaction details
export async function parseTransaction(
    signature: TransactionSignature,
    tokenAddress: string,
    walletPublicKey: string, // New parameter: wallet's public key
    connection: Connection
): Promise<TransactionResult> {
    try {
        // Fetch the transaction
        const transaction: ParsedTransactionWithMeta | null = await connection.getParsedTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });

        if (!transaction) {
            return {
                signature,
                tokenAmount: null,
                tokenSolPrice: null,
                tokenUsdPrice: null,
                transactionFee: null,
                netBuySolAmount: null,
                executionPrice: null,
                error: "Transaction not found or not confirmed",
            };
        }

        // Extract token amount from SPL token transfers
        let tokenAmount: number | null = null;
        const tokenMint = new PublicKey(tokenAddress);

        if (transaction.meta?.innerInstructions) {
            for (const inner of transaction.meta.innerInstructions) {
                for (const ix of inner.instructions) {
                    if ("parsed" in ix && ix.programId.equals(TOKEN_PROGRAM_ID)) {
                        const parsedInfo = ix.parsed.info;
                        if (parsedInfo.mint === tokenAddress && (ix.parsed.type === "transfer" || ix.parsed.type === "transferChecked")) {
                            tokenAmount =
                                parsedInfo.tokenAmount.uiAmount ||
                                parseFloat(parsedInfo.amount) / Math.pow(10, parsedInfo.tokenAmount.decimals);
                        }
                    }
                }
            }
        }

        // Estimate token price (for swap transactions)
        let tokenSolPrice: number | null = null;
        let tokenUsdPrice: number | null = null;
        let transactionFee: number | null = null;
        let netBuySolAmount: number | null = null;
        if (transaction.meta?.preTokenBalances && transaction.meta?.postTokenBalances) {
            const solBalanceChange = transaction.meta.preBalances[0] - transaction.meta.postBalances[0];
            transactionFee = transaction.meta.fee || 0;
            const netSolBalanceChange = solBalanceChange - transactionFee;
            netBuySolAmount = netSolBalanceChange / 1_000_000_000;
            const solAmount = netSolBalanceChange / 1_000_000_000;

            // Filter balances by wallet's public key
            const tokenPreBalance = transaction.meta.preTokenBalances.find(
                (bal: TokenBalance) => bal.mint === tokenAddress && bal.owner === walletPublicKey
            );
            const tokenPostBalance = transaction.meta.postTokenBalances.find(
                (bal: TokenBalance) => bal.mint === tokenAddress && bal.owner === walletPublicKey
            );

            // Handle cases where wallet had no tokens before or after
            const preAmount = tokenPreBalance ? tokenPreBalance.uiTokenAmount.uiAmount || 0 : 0;
            const postAmount = tokenPostBalance ? tokenPostBalance.uiTokenAmount.uiAmount || 0 : 0;
            const tokenAmountChange = postAmount - preAmount;

            if (tokenAmountChange !== 0 && solAmount !== 0) {
                // Price = SOL spent / Token received (or vice versa for sell)
                tokenSolPrice = Math.abs(solAmount / tokenAmountChange);

                let solUsdPrice = await getTokenPriceUSD(WSOL_ADDRESS);
                tokenUsdPrice = tokenSolPrice * solUsdPrice;
            }
        }

        return {
            signature,
            tokenAmount,
            tokenSolPrice,
            tokenUsdPrice,
            transactionFee: transactionFee ? transactionFee / 1_000_000_000 : 0,
            netBuySolAmount,
            executionPrice: tokenSolPrice,
            error: tokenAmount === null ? "No SPL token transfer found" : undefined,
        };
    } catch (error) {
        return {
            signature,
            tokenAmount: null,
            tokenSolPrice: null,
            tokenUsdPrice: null,
            transactionFee: null,
            netBuySolAmount: null,
            executionPrice: null,
            error: `Failed to parse transaction.`,
        };
    }
}
