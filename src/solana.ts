import bs58 from "bs58";
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
  BlockhashWithExpiryBlockHeight,
  SignatureStatus,
  TransactionSignature,
  TransactionConfirmationStatus,
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
import { Metaplex } from "@metaplex-foundation/js";
import * as config from "./config";
import axios from "axios";
const { fetchMarketAccounts } = require("./scripts/fetchMarketAccounts");
const { getPoolKeysByPoolId } = require("./scripts/getPoolKeysByPoolId");
import swap from "./swap";
import { JITO_TIP, SOLANA_CONNECTION } from ".";
import { connection } from "mongoose";
import { getWalletByChatId } from "./models/walletModel";
import { getKeypair, getPublicKeyinFormat } from "./controllers/sellController";
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

export const getSolBalance = async (privateKey: string) => {
  try {
    let privateKey_nums = bs58.decode(privateKey);
    let keypair = Keypair.fromSecretKey(privateKey_nums);

    const accountInfo = await SOLANA_CONNECTION.getAccountInfo(keypair.publicKey);

    if (accountInfo && accountInfo.lamports)
      return Number(accountInfo.lamports) / 10 ** 9;
    else return 0;
  } catch (error) {
    console.log(error);
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
    console.log(`Send SOL TX: ${signature}`);
    return signature;
  } catch (error) {
    console.log("Send SOL Erro: ", error);
    return null;
  }
};

async function getTokenAddressFromTokenAccount(tokenAccountAddress: string) {
  try {
    const tokenAccountPubkey = new PublicKey(tokenAccountAddress);
    const accountInfo = await SOLANA_CONNECTION.getAccountInfo(tokenAccountPubkey);

    if (accountInfo === null) {
      throw new Error("Token account not found");
    }

    const accountData = AccountLayout.decode(accountInfo.data);
    const mintAddress = new PublicKey(accountData.mint);

    // console.log(`Token address (mint address) for token account ${tokenAccountAddress}: ${mintAddress.toBase58()}`);
    return mintAddress.toBase58();
  } catch (error) {
    console.error("Error fetching token address:", error);
  }
}

export const getTokenSwapInfo = async (
  connection: Connection,
  signature: string
) => {
  console.log("getTokenSwapInfo, start");
  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    // console.log('tx = ', tx);

    const instructions = tx!.transaction.message.instructions;
    // console.log('instructions = ', instructions);

    const innerinstructions = tx!.meta!.innerInstructions;
    // console.log('innerInstructions = ', innerinstructions);

    // check if this is raydium swap trx
    const raydiumPoolV4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
    const jupiterAggregatorV6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    for (let i = 0; i < instructions.length; i++) {
      // console.log("programid = ", instructions[i].programId.toString());
      if (instructions[i].programId.toBase58() === raydiumPoolV4) {
        // console.log('index = ', i);
        for (let j = 0; j < innerinstructions!.length; j++) {
          if (innerinstructions![j].index === i) {
            // console.log("swap inner instructions, send = ", innerinstructions[j].instructions[0].parsed.info);
            // console.log("swap inner instructions, receive = ", innerinstructions[j].instructions[1].parsed.info);
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
            // console.log('swap info = ', result);
            return result;
          }
        }
      } else if (instructions[i].programId.toBase58() === jupiterAggregatorV6) {
        console.log("index = ", i);
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
            console.log("swap info = ", result);
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
    console.log("getTokenSwapInfo, Error");
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
    console.log("Fetching Pool details...", `  - Date:${new Date()}`);

    const marketData = await fetchMarketAccounts(
      CONNECTION,
      inputMint,
      outputMint,
      "confirmed"
    );
    // Fetching pool keys using the retrieved pool ID (marketData.id)
    var pool = await getPoolKeysByPoolId(marketData.id, CONNECTION);
    pool = convertPoolFormat(pool);
    console.log("Pools fetched", pool, `  - Date:${new Date()}`);
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
      console.log("http://solscan.io/tx/" + signature);
      return { confirmed: true, signature: signature };
    } else {
      console.log("Transaction failed");
      return { confirmed: false, signature: null };
    }
  } catch (e) {
    console.log("Transaction Failed");
    return { confirmed: false, signature: null };
  }
}

// export const jupiter_swap = async (CONNECTION: Connection, PRIVATE_KEY: string, publicKey: string, inputMint: string, outputMint: string, amount: number, swapMode: "ExactIn" | "ExactOut") => {
//   try {
//     console.log("~~final amount", amount)
//     const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
//     console.log("~~urlll", `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50&swapMode=${swapMode}`)
//     const quoteResponse = await (
//       await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount)}&slippageBps=50&swapMode=${swapMode}`
//       )
//     ).json();
//     console.log('quoteResponse = ', quoteResponse);

//     // get serialized transactions for the swap
//     const { swapTransaction } = await (
//       await fetch('https://quote-api.jup.ag/v6/swap', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json'
//         },
//         body: JSON.stringify({
//           quoteResponse,
//           userPublicKey: keypair.publicKey.toString(),
//           wrapAndUnwrapSol: true,
//           // prioritizationFeeLamports: 10000000
//         })
//       })
//     ).json();
//     console.log("~~~swapTransaction", swapTransaction)
//     // deserialize the transaction
//     const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
//     console.log("~~swapTransactionBuf", swapTransactionBuf)
//     var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
//     console.log("~~~transaction",transaction);

//     // sign the transaction
//     transaction.sign([keypair]);
//     const txSignature = bs58.encode(transaction.signatures[0]);
//     console.log("~txSignature", txSignature)
//     const latestBlockHash = await CONNECTION.getLatestBlockhash('processed');

//     const res = await jito_executeAndConfirm(CONNECTION, transaction, keypair, latestBlockHash, config.JITO_TIP);
//     const confirmed = res.confirmed;
//     const signature = res.signature;
//     if (confirmed) {
//       console.log("http://solscan.io/tx/" + txSignature);
//     } else {
//       console.log("Transaction failed");
//     }
//     return { confirmed, txSignature };
//   } catch (error) {
//     console.log('jupiter swap failed');
//     return { confirmed: false, signature: null };
//   }
// }

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
    const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(
      amount
    )}&slippageBps=${slippage}&swapMode=${swapMode}`;
    const quoteResponse = await fetch(quoteUrl).then((res) => res.json());
    if (quoteResponse.error) throw new Error("Failed to fetch quote response");

    const swapResponse = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: keypair.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 50000000,
            priorityLevel: "veryHigh", // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
          },
        },
      }),
    }).then((res) => res.json());
    if (!swapResponse.swapTransaction)
      throw new Error("Failed to get swap transaction");

    const swapTransaction = swapResponse.swapTransaction;
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    let transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    let latestBlockhash = await CONNECTION.getLatestBlockhash();
    transaction.message.recentBlockhash = latestBlockhash.blockhash; // Ensure fresh blockhash
    transaction.sign([keypair]);
    const txSignature = bs58.encode(transaction.signatures[0]);
    let res;
    if (isJito) {
      res = await jito_executeAndConfirm(
        CONNECTION,
        transaction,
        keypair,
        latestBlockhash,
        JITO_TIP
      );
    } else {
      res = await submitAndConfirm(transaction);
    }

    if (res.confirmed) {
      return { confirmed: true, txSignature: res.signature };
    } else {
      console.log("Transaction failed, retrying with new blockhash...");

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
    console.log("jupiter swap:", error);
    return { confirmed: false, txSignature: null };
  }
};

async function getRandomValidator() {
  const res =
    jito_Validators[Math.floor(Math.random() * jito_Validators.length)];
  return new PublicKey(res);
}
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
      console.log("Jito validator accepted the tx");
      return await jito_confirm(CONNECTION, txSignature, lastestBlockhash);
    } else {
      console.log("No Jito validators accepted the tx");
      return { confirmed: false, signature: txSignature };
    }
  } catch (e) {
    if (e instanceof axios.AxiosError) {
      console.log("Failed to execute the jito transaction");
    } else {
      console.log("Error during jito transaction execution: ", e);
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
  console.log("Confirming the jito transaction...");
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
    console.log("getDecimals error");
    return null;
  }
}

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
      console.log("utils.getTokenMetadata tokenInfo", token);
    }
  } catch (error) {
    console.log("getTokenMetadata", error);
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
    console.error("Error fetching token balance:", error);
    return null;
  }
};

export const getTokenInfofromMint = async (wallet: PublicKey, tokenAddress: string) => {
  const tokenPublicKey = new PublicKey(tokenAddress);
  const tokenAccount = getAssociatedTokenAddressSync(tokenPublicKey, wallet);
  try {
    const info = await SOLANA_CONNECTION.getTokenAccountBalance(tokenAccount);
    console.log("info", info)
    return info.value;
  } catch (error) {
    console.error("Error fetching token balance:", error);
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
    console.error("Error fetching wallet tokens:", error);
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

export const submitAndConfirm = async (transaction: VersionedTransaction) => {
  try {
    const signature = await SOLANA_CONNECTION.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: true,
        maxRetries: 3,
      }
    );
    await confirmTransaction(SOLANA_CONNECTION, signature);

    return {
      confirmed: true,
      signature,
    };
  } catch (e) {
    console.log("Error om simit:", e);
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

export const sendSPLtokens = async (chatId: number, mint: string, destination: string, amount: number, isPercentage: boolean) => {
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
    console.log("sendSPLtokens", e);
    return { confirmed: false }
  }
}
