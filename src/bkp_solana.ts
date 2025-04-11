import bs58 from 'bs58';
import {
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  ParsedInstruction,
  ParsedAccountData,
  VersionedTransaction,
  TransactionMessage,
  BlockhashWithExpiryBlockHeight
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, AccountLayout, TOKEN_2022_PROGRAM_ID, getMint, getAccount } from "@solana/spl-token";
import { Metaplex } from "@metaplex-foundation/js";
import * as config from './config';
import axios from 'axios';
import { logger } from './util';

const { fetchMarketAccounts } = require("./scripts/fetchMarketAccounts");
const { getPoolKeysByPoolId } = require("./scripts/getPoolKeysByPoolId");
import swap from "./swap";
import { JITO_TIP, SOLANA_CONNECTION } from '.';

export const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
export const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const LAMPORTS = LAMPORTS_PER_SOL;

const jito_Validators = [
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
];

const endpoints = [
  "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
];

const connection = SOLANA_CONNECTION

export const getSolBalance = async (privateKey: string) => {
  try {
    let privateKey_nums = bs58.decode(privateKey);
    let keypair = Keypair.fromSecretKey(privateKey_nums);
    const accountInfo = await connection.getAccountInfo(keypair.publicKey);
    if (accountInfo && accountInfo.lamports)
      return Number(accountInfo.lamports) / (10 ** 9);
    else
      return 0;
  } catch (error) {
    logger.error(error);
    return 0;
  }
};

export const isValidAddress = (publicKey: string) => {
  try {
    const key = new PublicKey(publicKey);
    return true;
  } catch (error) {
    return false;
  }
};

export const createWallet = () => {
  let keypair = Keypair.generate();
  let publicKey = keypair.publicKey.toBase58();
  let privateKey = bs58.encode(keypair.secretKey);
  return { publicKey, privateKey };
};

export const getPublicKey = (privateKey: string) => {
  let keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  let publicKey = keypair.publicKey.toBase58();
  return publicKey;
};

export function getKeyPairFromPrivateKey(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

const sendSOL = async (senderPrivateKey: string, receiverAddress: string, amount: number) => {
  try {
    let privateKey_nums = bs58.decode(senderPrivateKey);
    let senderKeypair = Keypair.fromSecretKey(privateKey_nums);
    let transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderKeypair.publicKey,
        toPubkey: new PublicKey(receiverAddress),
        lamports: Math.round(LAMPORTS_PER_SOL * amount)
      })
    );
    transaction.feePayer = senderKeypair.publicKey;
    const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair]);
    logger.info(`Send SOL TX: ${signature}`);
    return signature;
  } catch (error) {
    logger.error("Send SOL Erro: ", error);
    return null;
  }
};

async function getTokenAddressFromTokenAccount(tokenAccountAddress: string) {
  try {
    const tokenAccountPubkey = new PublicKey(tokenAccountAddress);
    const accountInfo = await connection.getAccountInfo(tokenAccountPubkey);
    if (accountInfo === null) {
      throw new Error('Token account not found');
    }
    const accountData = AccountLayout.decode(accountInfo.data);
    const mintAddress = new PublicKey(accountData.mint);
    return mintAddress.toBase58();
  } catch (error) {
    console.error('Error fetching token address:', error);
  }
}

export const getTokenSwapInfo = async (connection: Connection, signature: string) => {
  logger.info("getTokenSwapInfo, start");
  try {
    const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
    const instructions = tx!.transaction.message.instructions;
    const innerinstructions = tx!.meta!.innerInstructions;
    const raydiumPoolV4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
    const jupiterAggregatorV6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    for (let i = 0; i < instructions.length; i++) {
      if (instructions[i].programId.toBase58() === raydiumPoolV4) {
        for (let j = 0; j < innerinstructions!.length; j++) {
          if (innerinstructions![j].index === i) {
            const sendToken = await getTokenAddressFromTokenAccount((innerinstructions![j].instructions[0] as ParsedInstruction).parsed.info.destination);
            const sendAmount = (innerinstructions![j].instructions[0] as ParsedInstruction).parsed.info.amount;
            const receiveToken = await getTokenAddressFromTokenAccount((innerinstructions![j].instructions[1] as ParsedInstruction).parsed.info.source);
            const receiveAmount = (innerinstructions![j].instructions[1] as ParsedInstruction).parsed.info.amount;
            const result = { isSwap: true, type: "raydium swap", sendToken, sendAmount, receiveToken, receiveAmount };
            return result;
          }
        }
      } else if (instructions[i].programId.toBase58() === jupiterAggregatorV6) {
        logger.info('index = ', i);
        for (let j = 0; j < innerinstructions!.length; j++) {
          if (innerinstructions![j].index === i) {
            const length = innerinstructions![j].instructions.length;
            let sendToken;
            let sendAmount;
            let receiveToken;
            let receiveAmount;
            for (let k = 0; k < length; k++) {
              const instr = innerinstructions![j].instructions[k] as ParsedInstruction;
              if (instr.programId.toBase58() == 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                if (instr.parsed.type == "transferChecked") {
                  sendToken = await getTokenAddressFromTokenAccount(instr.parsed.info.destination);
                  sendAmount = instr.parsed.info.tokenAmount.amount;
                  break;
                }
                if (instr.parsed.type == "transfer") {
                  sendToken = await getTokenAddressFromTokenAccount(instr.parsed.info.destination);
                  sendAmount = instr.parsed.info.amount;
                  break;
                }
              }
            }
            for (let k = length - 1; k >= 0; k--) {
              const instr = innerinstructions![j].instructions[k] as ParsedInstruction;
              if (instr.programId.toBase58() == 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                if (instr.parsed.type == "transferChecked") {
                  receiveToken = await getTokenAddressFromTokenAccount(instr.parsed.info.source);
                  receiveAmount = instr.parsed.info.tokenAmount.amount;
                  break;
                }
                if (instr.parsed.type == "transfer") {
                  receiveToken = await getTokenAddressFromTokenAccount(instr.parsed.info.source);
                  receiveAmount = instr.parsed.info.amount;
                  break;
                }
              }
            }
            const result = { isSwap: true, type: "jupiter swap", sendToken, sendAmount, receiveToken, receiveAmount, blockTime: tx?.blockTime };
            logger.info('swap info = ', result);
            return result;
          }
        }
      }
    }
    return { isSwap: false, type: null, sendToken: null, sendAmount: null, receiveToken: null, receiveAmount: null, blockTime: null };
  } catch (error) {
    logger.error('getTokenSwapInfo, Error');
    return { isSwap: false, type: null, sendToken: null, sendAmount: null, receiveToken: null, receiveAmount: null, blockTime: null };
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
  logger.info("Fetching Pool details...", `  - Date:${new Date()}`);
  // Convert input strings to PublicKey objects.
  const inputMintPK = new PublicKey(inputMint);
  const outputMintPK = new PublicKey(outputMint);

  const marketData = await fetchMarketAccounts(CONNECTION, inputMintPK, outputMintPK, "confirmed");
  let pool = await getPoolKeysByPoolId(marketData.id, CONNECTION);
  pool = convertPoolFormat(pool);
  logger.info("Pools fetched", pool, `  - Date:${new Date()}`);

  const swapConfig = {
    executeSwap: true,
    useVersionedTransaction: true,
    tokenAAmount: amount,
    tokenAAddress: inputMintPK.toBase58(),
    tokenBAddress: outputMintPK.toBase58(),
    maxLamports: 1500000,
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
    logger.info("Transaction failed . bkp_solana");
    logger.info("swapresp " + swapResp);
    return { confirmed: false, signature: null };
  }
}


export const jupiter_swap = async (
  CONNECTION: Connection,
  PRIVATE_KEY: string,
  userPublicKey: string,
  inputMint: string,
  outputMint: string,
  amount: number,
  swapMode: "ExactIn" | "ExactOut"
) => {
  logger.info("=== [Jupiter Swap]: Start ===");

  // Step 1: Log everything up front for clarity
  logger.info("[1/9] Private Key (first 8 chars):", PRIVATE_KEY.slice(0, 8), "... length:", PRIVATE_KEY.length);
  logger.info("[1/9] userPublicKey param:", userPublicKey);
  logger.info("[1/9] inputMint:", inputMint);
  logger.info("[1/9] outputMint:", outputMint);
  logger.info("[1/9] amount:", amount);
  logger.info("[1/9] swapMode:", swapMode);

  // Step 2: Validate mints are base58
  const isBase58 = (candidate: string) => {
    // Basic check: all characters must be in the base58 set
    // (Regex excludes 0, O, I, l which are removed from the typical base58 set)
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(candidate);
  };

  if (!isBase58(inputMint)) {
    logger.error("❌ inputMint is not valid base58:", inputMint);
    logger.error("Characters must be in [1-9 A-HJ-NP-Za-km-z] (no 0, O, I, l).");
    return { confirmed: false, signature: null };
  }

  if (!isBase58(outputMint)) {
    logger.error("❌ outputMint is not valid base58:", outputMint);
    logger.error("Characters must be in [1-9 A-HJ-NP-Za-km-z] (no 0, O, I, l).");
    return { confirmed: false, signature: null };
  }

  try {
    new PublicKey(inputMint);
  } catch (e) {
    logger.error("❌ inputMint is not a valid Solana public key:", e);
    return { confirmed: false, signature: null };
  }

  try {
    new PublicKey(outputMint);
  } catch (e) {
    logger.error("❌ outputMint is not a valid Solana public key:", e);
    return { confirmed: false, signature: null };
  }

  // Step 3: Decode user Keypair
  let keypair: Keypair;
  try {
    const decoded = bs58.decode(PRIVATE_KEY);
    keypair = Keypair.fromSecretKey(decoded);
  } catch (err) {
    logger.error("❌ Failed to decode PRIVATE_KEY into a Keypair:", err);
    return { confirmed: false, signature: null };
  }
  const derivedUserPubkey = keypair.publicKey.toBase58();
  logger.info("[2/9] Derived userPubkey from PRIVATE_KEY:", derivedUserPubkey);

  // Step 4: Build the Jupiter quote URL
  const floorAmount = Math.floor(amount);
  const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${floorAmount}&slippageBps=50&swapMode=${swapMode}`;
  logger.info("[3/9] Jupiter quote URL:", quoteUrl);

  // Step 5: Fetch quote
  let quoteResponse: any;
  try {
    const quoteRaw = await fetch(quoteUrl);
    quoteResponse = await quoteRaw.json();
  } catch (err) {
    logger.error("❌ Failed to fetch/parse Jupiter quote:", err);
    return { confirmed: false, signature: null };
  }
  logger.info("[4/9] Jupiter quote response:", quoteResponse);

  if (!quoteResponse || !quoteResponse.routes || quoteResponse.routes.length === 0) {
    logger.error("❌ Invalid or empty quote response from Jupiter.");
    return { confirmed: false, signature: null };
  }

  // Step 6: Prepare swap request payload
  const swapPayload = {
    quoteResponse,
    userPublicKey: derivedUserPubkey, // We always swap using the actual derived publicKey
    wrapAndUnwrapSol: true,
  };
  logger.info("[5/9] Swap payload to be sent:", swapPayload);

  let swapData: any;
  try {
    const swapResp = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapPayload),
    });
    swapData = await swapResp.json();
  } catch (err) {
    logger.error("❌ Failed to fetch/parse Jupiter swap response:", err);
    return { confirmed: false, signature: null };
  }
  logger.info("[6/9] Jupiter swap response:", swapData);

  const { swapTransaction } = swapData;
  if (!swapTransaction) {
    logger.error("❌ 'swapTransaction' missing in the swap response. Full data:", swapData);
    return { confirmed: false, signature: null };
  }
  logger.info("[6/9] Encoded swap transaction (first 50 chars):", swapTransaction.slice(0, 50) + "...");

  // Step 7: Deserialize the transaction
  let transaction: VersionedTransaction;
  try {
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  } catch (err) {
    logger.error("❌ Failed to deserialize the base64 'swapTransaction':", err);
    return { confirmed: false, signature: null };
  }

  // Step 8: Sign transaction
  transaction.sign([keypair]);
  const localSig = bs58.encode(transaction.signatures[0]);
  logger.info("[7/9] Signed transaction with localSig:", localSig);

  // Step 9: Get latest blockhash & Jito confirm
  let latestBlockhash: BlockhashWithExpiryBlockHeight;
  try {
    latestBlockhash = await CONNECTION.getLatestBlockhash("processed");
  } catch (err) {
    logger.error("❌ Failed to get latest blockhash:", err);
    return { confirmed: false, signature: null };
  }
  logger.info("[8/9] Latest blockhash:", latestBlockhash);

  logger.info("[9/9] Sending transaction to jito_executeAndConfirm...");
  const res = await jito_executeAndConfirm(CONNECTION, transaction, keypair, latestBlockhash, JITO_TIP);
  const { confirmed, signature } = res;

  if (confirmed) {
    logger.info(`✅ Swap confirmed! See details: https://solscan.io/tx/${signature}`);
  } else {
    logger.error("❌ Swap failed or not confirmed.");
  }

  logger.info("=== [Jupiter Swap]: End ===\n");
  return { confirmed, signature };
};

async function getRandomValidator() {
  const res =
    jito_Validators[Math.floor(Math.random() * jito_Validators.length)];
  return new PublicKey(res);
}

export async function jito_executeAndConfirm(
  CONNECTION: Connection,
  transaction: VersionedTransaction,
  payer: Keypair,
  lastestBlockhash: BlockhashWithExpiryBlockHeight,
  jitofee: number
) {
  logger.info("Executing transaction (jito)...");
  const jito_validator_wallet = await getRandomValidator();
  logger.info("Selected Jito Validator: ", jito_validator_wallet.toBase58());
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
    const jitoTxSignature = bs58.encode(jitoFee_transaction.signatures[0]);
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
    logger.info("~~requests", requests)
    logger.info("Sending tx to Jito validators...");
    const res = await Promise.all(requests.map((p) => p.catch((e) => e)));
    const success_res = res.filter((r) => !(r instanceof Error));
    if (success_res.length > 0) {
      logger.info("Jito validator accepted the tx");
      return await jito_confirm(CONNECTION, jitoTxSignature, lastestBlockhash);
    } else {
      logger.info("No Jito validators accepted the tx");
      return { confirmed: false, signature: jitoTxSignature };
    }
  } catch (e) {
    if (e instanceof axios.AxiosError) {
      logger.info("Failed to execute the jito transaction");
    } else {
      logger.error("Error during jito transaction execution: ", e);
    }
    return { confirmed: false, signature: null };
  }
}

async function jito_confirm(CONNECTION: Connection, signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
  logger.info("Confirming the jito transaction...");
  const confirmation = await CONNECTION.confirmTransaction(
    {
      signature,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
    },
    "confirmed"
  );
  logger.info("~~~confirmation", confirmation)
  return { confirmed: !confirmation.value.err, signature };
}

export async function getDecimals(connection: Connection, mintAddress: PublicKey) {
  try {
    const info = await connection.getParsedAccountInfo(mintAddress);
    const result = ((info.value?.data) as ParsedAccountData).parsed.info.decimals || 0;
    return result;
  } catch (error) {
    logger.error('getDecimals error');
    return null;
  }
}

export const getTokenMetaData = async (CONNECTION: Connection, address: string) => {
  try {
    const metaplex = Metaplex.make(CONNECTION);
    const mintAddress = new PublicKey(address);
    const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });
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
        mintInfo = await getMint(CONNECTION, mintAddress, "confirmed", TOKEN_PROGRAM_ID);
        token_type = "spl-token";
      } else {
        mintInfo = await getMint(CONNECTION, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID);
        token_type = "spl-token-2022";
      }
      if (mintInfo) {
        totalSupply = Number(mintInfo.supply / BigInt(10 ** decimals));
      }
      const metaData = { name, symbol, logo, decimals, address, totalSupply, description, extensions, renounced, type: token_type };
      return metaData;
    } else {
      logger.info("utils.getTokenMetadata tokenInfo", token);
    }
  } catch (error) {
    logger.error("getTokenMetadata", error);
  }
  return null;
}

export const getTokenBalance = async (CONNECTION: Connection, walletAddress: string, tokenAddress: string) => {
  const walletPublicKey = new PublicKey(walletAddress);
  const tokenPublicKey = new PublicKey(tokenAddress);
  const associatedTokenAddress = await PublicKey.findProgramAddress(
    [
      walletPublicKey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      tokenPublicKey.toBuffer(),
    ],
    new PublicKey('ATokenGPvnNbtrh4MGx8o8wK7bPt6MrdAz7hKkG6QRJA')
  );
  try {
    const tokenAccount = await getAccount(CONNECTION, associatedTokenAddress[0]);
    const balance = tokenAccount.amount;
    return balance;
  } catch (error) {
    logger.error('Error fetching token balance:', error);
    return null;
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
