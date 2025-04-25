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
const { fetchMarketAccounts } = require("../scripts/fetchMarketAccounts");
const { getPoolKeysByPoolId } = require("../scripts/getPoolKeysByPoolId");
import swap from "../swap";
import { FEE_COLLECTION_WALLET, JITO_TIP, SOLANA_CONNECTION } from "..";
import { getWalletByChatId } from "../models/walletModel";
import { getKeypair } from "./util";
import { logger } from "../util";
import { getTokenMetaData } from "./token";
export const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
export const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const LAMPORTS = LAMPORTS_PER_SOL;
const whitelistedUsers: string[] = require("../util/whitelistUsers.json");


const endpoints = [
  "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
];

const sendSOL = async (
  senderPrivateKey: string,
  receiverAddress: string,
  amount: number
) => {
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
    const signature = await sendAndConfirmTransaction(SOLANA_CONNECTION, transaction, [
      senderKeypair,
    ]);
    logger.info("Send SOL TX: ", { signature });
    return signature;
  } catch (error: any) {
    logger.error("Send SOL Erro: ", { error });
    return null;
  }
};


export async function swapToken(
  CONNECTION: Connection,
  PRIVATE_KEY: string,
  publicKey: string,
  inputMint: string,
  outputMint: string,
  amount: number,
  swapMode: "ExactIn" | "ExactOut"
) {
  // Fetching market data for the tokens to retrieve the pool ID
  try {
    logger.info("Fetching Pool details...", `  - Date:${new Date()}`);

    const marketData = await fetchMarketAccounts(
      CONNECTION,
      inputMint,
      outputMint,
      "confirmed"
    );
    // Fetching pool keys using the retrieved pool ID (marketData.id)
    var pool = await getPoolKeysByPoolId(marketData.id, CONNECTION);
    pool = convertPoolFormat(pool);
    logger.info("Pools fetched", pool, `  - Date:${new Date()}`);
    var swapConfig = {
      executeSwap: true, // Send tx when true, simulate tx when false
      useVersionedTransaction: true,
      tokenAAmount: amount,
      tokenAAddress: inputMint,
      tokenBAddress: outputMint,
      maxLamports: 1500000, // Micro lamports for priority fee
      direction: "in",
      pool: pool,
      maxRetries: 20,
    };
    let swapResp = await swap(swapConfig, PRIVATE_KEY);

    let confirmed: boolean = false;
    let signature = null;
    if (swapResp) {
      confirmed = swapResp.confirmed;
      signature = swapResp.signature;
    }
    if (confirmed) {
      logger.info("http://solscan.io/tx/" + signature);
      return { confirmed: true, signature: signature };
    } else {
      //TODO check insufficent funds!
      logger.info("Transaction failed (solana)");
      logger.info("swapResp " + swapResp);
      return { confirmed: false, signature: null };
    }
  } catch (e) {
    logger.error("Transaction Failed (solana). :", { error: e });
    return { confirmed: false, signature: null };
  }
}

interface SwapQuote {
  inAmount: string;
  outAmount: string;
  [key: string]: any;
}

interface SwapInstructionsResponse {
  tokenLedgerInstruction?: any[];
  computeBudgetInstructions: any[];
  setupInstructions: any[];
  swapInstruction: any;
  cleanupInstruction: any;
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
          priorityLevel: "veryHigh"
        }
      }
    })
  }).then(r => r.json() as Promise<SwapInstructionsResponse>);

  if (res.error) throw new Error("Swap-instructions error: " + res.error);

  // 2) helper to decode each payload into a TransactionInstruction
  const deserialize = (instr: any) =>
    new TransactionInstruction({
      programId: new PublicKey(instr.programId),
      keys: instr.accounts.map((a: any) => ({
        pubkey: new PublicKey(a.pubkey),
        isSigner: a.isSigner,
        isWritable: a.isWritable
      })),
      data: Buffer.from(instr.data, "base64")
    });

  // 3) turn each section into real instructions
  const allInstr = [
    ...res.computeBudgetInstructions.map(deserialize),
    ...res.setupInstructions.map(deserialize),
    deserialize(res.swapInstruction),
    deserialize(res.cleanupInstruction)
  ];

  // 4) fetch and deserialize any address‑lookup tables
  const lookupAccounts = await Promise.all(
    res.addressLookupTableAddresses.map(async (addr) => {
      const info = await SOLANA_CONNECTION.getAccountInfo(new PublicKey(addr));
      if (!info) return null;
      return new AddressLookupTableAccount({
        key: new PublicKey(addr),
        state: AddressLookupTableAccount.deserialize(info.data)
      });
    })
  );

  return {
    instructions: allInstr,
    addressLookupTableAccounts: lookupAccounts.filter((x): x is AddressLookupTableAccount => !!x)
  };
}


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
    let feeAmount = 0;
    const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

    const quoteUrl = `https://api.jup.ag/swap/v1/quote`
      + `?inputMint=${inputMint}`
      + `&outputMint=${outputMint}`
      + `&amount=${Math.floor(amount)}`
      + `&slippageBps=${slippage}`
      + `&swapMode=${swapMode}`;

    logger.info("Fetching quote from Jupiter:", quoteUrl);
    const quoteResponse = await fetch(quoteUrl).then((res) => res.json());
    if (quoteResponse.error) throw new Error("Failed to fetch quote response");
    logger.info("Quote response received", quoteResponse);
    if (inputMint == "So11111111111111111111111111111111111111112") {
      feeAmount = Math.floor(parseInt(quoteResponse.inAmount) / 100);
    } else {
      feeAmount = Math.floor(parseInt(quoteResponse.outAmount) / 100);
    }
    logger.info("Calculated feeAmount:", feeAmount);

    const { instructions, addressLookupTableAccounts } = await getSwapInstructions(
      quoteResponse,
      keypair.publicKey.toBase58()
    );

    if (!whitelistedUsers.includes(keypair.publicKey.toBase58())) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: feePayer,
          lamports: feeAmount
        })
      );
    }
    const { blockhash } = await SOLANA_CONNECTION.getLatestBlockhash();
    let latestBlockhash = await CONNECTION.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message(addressLookupTableAccounts);

    const transaction = new VersionedTransaction(messageV0);
    logger.info("Fetched latestBlockhash:", latestBlockhash);
    transaction.message.recentBlockhash = latestBlockhash.blockhash;
    transaction.sign([keypair]);

    let res;
    if (isJito) {
      logger.info("submit jito");
      res = await jito_executeAndConfirm(
        CONNECTION,
        transaction,
        keypair,
        latestBlockhash,
        JITO_TIP
      );
    } else {
      logger.info("Solana: submit tx");
      res = await submitAndConfirm(transaction);
    }

    if (res.confirmed) {
      logger.info("Solana: confirmed");
      return { confirmed: true, txSignature: res.signature };
    } else {
      logger.info("Solana: Transaction failed, retrying with new blockhash...");

      latestBlockhash = await CONNECTION.getLatestBlockhash("processed");
      transaction.message.recentBlockhash = latestBlockhash.blockhash;
      transaction.sign([keypair]);

      const retryRes = await jito_executeAndConfirm(
        CONNECTION,
        transaction,
        keypair,
        latestBlockhash,
        JITO_TIP
      );

      if (retryRes.confirmed) {
        return { confirmed: true, txSignature: retryRes.signature };
      }
    }
    return { confirmed: false, txSignature: null };
  } catch (error) {
    logger.error("jupiter swap:", { error });

    logger.error(inputMint);
    logger.error(outputMint);
    logger.error(amount);
    logger.error(swapMode);
    logger.error(error);

    return { confirmed: false, txSignature: null };
  }
};


/**
 * Executes and confirms a Jito transaction.
 * @param {Transaction} transaction - The transaction to be executed and confirmed.
 * @param {Account} payer - The payer account for the transaction.
 * @param {Blockhash} lastestBlockhash - The latest blockhash.
 * @param {number} jitofee - The fee for the Jito transaction.
 * @returns {Promise<{ confirmed: boolean, signature: string | null }>} - A promise that resolves to an object containing the confirmation status and the transaction signature.
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
    const serializedJitoFeeTransaction = bs58.encode(
      jitoFee_transaction.serialize()
    );
    const serializedTransaction = bs58.encode(transaction.serialize());
    const final_transaction = [
      serializedJitoFeeTransaction,
      serializedTransaction,
    ];
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
 * Confirms a transaction on the Solana blockchain.
 * @param {string} signature - The signature of the transaction.
 * @param {object} latestBlockhash - The latest blockhash information.
 * @returns {object} - An object containing the confirmation status and the transaction signature.
 */
async function jito_confirm(
  CONNECTION: Connection,
  signature: string,
  latestBlockhash: BlockhashWithExpiryBlockHeight
) {
  logger.info("Confirming the jito transaction...");
  await confirmTransaction(SOLANA_CONNECTION, signature);
  return { confirmed: true, signature };
}

export async function getDecimals(
  connection: Connection,
  mintAddress: PublicKey
) {
  try {
    const info = await connection.getParsedAccountInfo(mintAddress);
    const result =
      (info.value?.data as ParsedAccountData).parsed.info.decimals || 0;
    return result;
  } catch (error) {
    logger.error("getDecimals error");
    return null;
  }
}

export const getAllTokensWithBalance = async (
  connection: Connection,
  owner: PublicKey
) => {
  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      owner,
      {
        programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      }
    );
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

function convertPoolFormat(pool: any) {
  return {
    id: pool.id.toString(),
    programId: pool.programId.toString(),
    status: pool.status.toNumber(),
    baseDecimals: pool.baseDecimals,
    quoteDecimals: pool.quoteDecimals,
    lpDecimals: pool.lpDecimals,
    baseMint: pool.baseMint.toString(),
    quoteMint: pool.quoteMint.toString(),
    version: pool.version,
    authority: pool.authority.toString(),
    openOrders: pool.openOrders.toString(),
    baseVault: pool.baseVault.toString(),
    quoteVault: pool.quoteVault.toString(),
    marketProgramId: pool.marketProgramId.toString(),
    marketId: pool.marketId.toString(),
    marketBids: pool.marketBids.toString(),
    marketAsks: pool.marketAsks.toString(),
    marketEventQueue: pool.marketEventQueue.toString(),
    marketBaseVault: pool.marketBaseVault.toString(),
    marketQuoteVault: pool.marketQuoteVault.toString(),
    marketAuthority: pool.marketAuthority.toString(),
    targetOrders: pool.targetOrders.toString(),
    lpMint: pool.lpMint.toString(),
  };
}

const MAX_RETRIES = 3;

export const submitAndConfirm = async (transaction: VersionedTransaction) => {
  try {
    const signature = await SOLANA_CONNECTION.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: true,
        maxRetries: MAX_RETRIES,
      }
    );
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
    const { value: statuses } = await connection.getSignatureStatuses(
      [signature],
      { searchTransactionHistory }
    );

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

    if (
      status.confirmationStatus &&
      status.confirmationStatus === desiredConfirmationStatus
    ) {
      return status;
    }

    if (status.confirmationStatus === "finalized") {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
};


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
  } catch (error: any) {
    logger.error("withdrawSOL Error: ", { error: error });
    return { confirmed: false, error: error.message };
  }
}