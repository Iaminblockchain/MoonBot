// tx-helpers.ts
import { Connection, SignatureStatus } from "@solana/web3.js";
import { logger } from "../logger";
/*   error codes & texts  */
export const ERR_1001 = "Unknown instruction error";
export const ERR_1002 = "Provided owner is not allowed";
export const ERR_1003 = "custom program error: insufficient funds";
export const ERR_1011 = "Not known Error";

export const ERR_6002 = "slippage: Too much SOL required to buy the given amount of tokens.";
export const ERR_6003 = "slippage: Too little SOL received to sell the given amount of tokens.";

/*  helpers  */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TokenBalance {
    mint: string;
    owner: string;
    uiTokenAmount?: {
        uiAmount: number | null;
    };
}

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
                commitment: "confirmed",
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
                commitment: "finalized",
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
    return metrics;
}

// extract metrics
export function extractTransactionMetrics(tx: Transaction, tokenMint: string): Record<string, unknown> {
    const message = tx.transaction?.message;
    if (!message) return {};

    const accountKeys: string[] = message.accountKeys || [];
    const ownerPubkey = accountKeys[0] ?? "";

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

    const preToken = getTokenBalance(preTokenBalances, tokenMint, ownerPubkey);
    const postToken = getTokenBalance(postTokenBalances, tokenMint, ownerPubkey);
    const tokenBalanceChange = postToken - preToken;

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

    const price = Math.abs(tokenBalanceChange) > 1e-6 ? solBalanceChange / Math.abs(tokenBalanceChange) : null;

    return {
        owner_pubkey: ownerPubkey,
        token: tokenMint,
        token_balance_change: tokenBalanceChange,
        transaction_fee: fee,
        sol_balance_change: solBalanceChange,
        token_creation_cost: tokenCreationCost,
        compute_units_consumed: computeUnits,
        price,
    };
}
