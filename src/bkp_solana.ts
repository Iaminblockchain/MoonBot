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

const { fetchMarketAccounts } = require("./scripts/fetchMarketAccounts");
const { getPoolKeysByPoolId } = require("./scripts/getPoolKeysByPoolId");
import swap from "./swap";

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

const connection = new Connection(config.SOLANA_RPC_ENDPOINT, { 
  wsEndpoint: config.SOLANA_WSS_ENDPOINT, 
  commitment: "confirmed" 
});

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
  console.log("getTokenSwapInfo, start");
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
        console.log('index = ', i);
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
            console.log('swap info = ', result);
            return result;
          }
        }
      }
    }
    return { isSwap: false, type: null, sendToken: null, sendAmount: null, receiveToken: null, receiveAmount: null, blockTime: null };
  } catch (error) {
    console.log('getTokenSwapInfo, Error');
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
  console.log("Fetching Pool details...", `  - Date:${new Date()}`);
  // Convert input strings to PublicKey objects.
  const inputMintPK = new PublicKey(inputMint);
  const outputMintPK = new PublicKey(outputMint);
  
  const marketData = await fetchMarketAccounts(CONNECTION, inputMintPK, outputMintPK, "confirmed");
  let pool = await getPoolKeysByPoolId(marketData.id, CONNECTION);
  pool = convertPoolFormat(pool);
  console.log("Pools fetched", pool, `  - Date:${new Date()}`);
  
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
  if(swapResp){
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
}

export const jupiter_swap = async (
  CONNECTION: Connection, 
  PRIVATE_KEY: string, 
  publicKey: string, 
  inputMint: string, 
  outputMint: string, 
  amount: number, 
  swapMode: "ExactIn" | "ExactOut"
) => {
  try {
    console.log("~~final amount", amount)
    const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
    console.log("~~urlll", `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50&swapMode=${swapMode}`)
    const quoteResponse = await (
      await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount)}&slippageBps=50&swapMode=${swapMode}`)
    ).json();
    console.log('quoteResponse = ', quoteResponse);
    const { swapTransaction } = await (
      await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: keypair.publicKey.toString(),
          wrapAndUnwrapSol: true,
        })
      })
    ).json();
    console.log("~~~swapTransaction", swapTransaction)
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    console.log("~~swapTransactionBuf", swapTransactionBuf)
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    console.log("~~~transaction", transaction);
    transaction.sign([keypair]);
    const txSignature = bs58.encode(transaction.signatures[0]);
    console.log("~txSignature", txSignature)
    const latestBlockHash = await CONNECTION.getLatestBlockhash('processed');
    const res = await jito_executeAndConfirm(CONNECTION, transaction, keypair, latestBlockHash, config.JITO_TIP);
    const confirmed = res.confirmed;
    const signature = res.signature;
    if (confirmed) {
      console.log("http://solscan.io/tx/" + txSignature);
    } else {
      console.log("Transaction failed");
    }
    return { confirmed, txSignature };
  } catch (error) {
    console.log('jupiter swap failed');
    return { confirmed: false, signature: null };
  }
}

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
  console.log("Executing transaction (jito)...");
  const jito_validator_wallet = await getRandomValidator();
  console.log("Selected Jito Validator: ", jito_validator_wallet.toBase58());
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
    console.log("~~requests", requests)
    console.log("Sending tx to Jito validators...");
    const res = await Promise.all(requests.map((p) => p.catch((e) => e)));
    const success_res = res.filter((r) => !(r instanceof Error));
    if (success_res.length > 0) {
      console.log("Jito validator accepted the tx");
      return await jito_confirm(CONNECTION, jitoTxSignature, lastestBlockhash);
    } else {
      console.log("No Jito validators accepted the tx");
      return { confirmed: false, signature: jitoTxSignature };
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

async function jito_confirm(CONNECTION: Connection, signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
  console.log("Confirming the jito transaction...");
  const confirmation = await CONNECTION.confirmTransaction(
    {
      signature,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
    },
    "confirmed"
  );
  console.log("~~~confirmation", confirmation)
  return { confirmed: !confirmation.value.err, signature };
}

export async function getDecimals(connection: Connection, mintAddress: PublicKey) {
  try {
    const info = await connection.getParsedAccountInfo(mintAddress);
    const result = ((info.value?.data) as ParsedAccountData).parsed.info.decimals || 0;
    return result;
  } catch (error) {
    console.log('getDecimals error');
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
      console.log('metaData = ', metaData);
      return metaData;
    } else {
      console.log("utils.getTokenMetadata tokenInfo", token);
    }
  } catch (error) {
    console.log("getTokenMetadata", error);
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
    console.error('Error fetching token balance:', error);
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
