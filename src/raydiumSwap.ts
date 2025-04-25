import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, TransactionMessage } from '@solana/web3.js'
import {
  Liquidity,
  LiquidityPoolKeys,
  jsonInfo2PoolKeys,
  LiquidityPoolJsonInfo,
  TokenAccount,
  Token,
  TokenAmount,
  TOKEN_PROGRAM_ID,
  Percent,
  SPL_ACCOUNT_LAYOUT,
} from '@raydium-io/raydium-sdk'
import { Wallet } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import * as config from './config';
import { logger } from './logger';
/**
 * Class representing a Raydium Swap operation.
 */
class RaydiumSwap {
  allPoolKeysJson: LiquidityPoolJsonInfo[]
  connection: Connection
  wallet: Wallet

    /**
   * Create a RaydiumSwap instance.
   * @param {string} RPC_URL - The RPC URL for connecting to the Solana blockchain.
   * @param {string} WALLET_PRIVATE_KEY - The private key of the wallet in base58 format.
   */
  constructor(RPC_URL: string, WALLET_PRIVATE_KEY: string) {
    this.connection = new Connection(RPC_URL
      , { commitment: 'confirmed' })
    this.wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(bs58.decode(WALLET_PRIVATE_KEY))))
    this.allPoolKeysJson = []
  }

   /**
   * Loads all the pool keys available from a JSON configuration file.
   * @async
   * @returns {Promise<void>}
   */
  async loadPoolKeys(pool: any) {
    this.allPoolKeysJson = [pool]
  }

    /**
   * Finds pool information for the given token pair.
   * @param {string} mintA - The mint address of the first token.
   * @param {string} mintB - The mint address of the second token.
   * @returns {LiquidityPoolKeys | null} The liquidity pool keys if found, otherwise null.
   */
  findPoolInfoForTokens(mintA: string, mintB: string) {
    mintA = mintA.toString();
    mintB = mintB.toString()
    const poolData = this.allPoolKeysJson.find(
        (i: LiquidityPoolJsonInfo) => (i.baseMint === mintA && i.quoteMint === mintB) || (i.baseMint === mintB && i.quoteMint === mintA)
    );        
    if (!poolData) return null;
    return jsonInfo2PoolKeys(poolData);
  }

  
  async getOwnerTokenAccounts() {
    const walletTokenAccount = await this.connection.getTokenAccountsByOwner(this.wallet.publicKey, {
        programId: TOKEN_PROGRAM_ID,
    });

    return walletTokenAccount.value.map((i) => ({
        pubkey: i.pubkey,
        programId: i.account.owner,
        accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }));
}

async getSwapTransaction(toToken: any, amount: any, poolKeys: any, maxLamports = 100000, useVersionedTransaction = true, fixedSide:any = 'in') {
  logger.info(`toToken: ${toToken}\namount: ${amount}\npoolKeys: ${poolKeys}\nmaxLamports: ${maxLamports}\nuseVersionedTransaction: ${useVersionedTransaction}\nfixedSide: ${fixedSide}`)
    const directionIn = poolKeys.quoteMint.toString() == toToken;
    const { minAmountOut, amountIn } = await this.calcAmountOut(poolKeys, amount, directionIn);

    const userTokenAccounts = await this.getOwnerTokenAccounts();
    const swapTransaction = await Liquidity.makeSwapInstructionSimple({
        connection: this.connection,
        makeTxVersion: useVersionedTransaction ? 0 : 1,
        poolKeys: { ...poolKeys },
        userKeys: {
            tokenAccounts: userTokenAccounts,
            owner: this.wallet.publicKey,
        },
        amountIn: amountIn,
        amountOut: minAmountOut,
        fixedSide: fixedSide,
        config: { bypassAssociatedCheck: false },
        computeBudgetConfig: { microLamports: maxLamports },
    });

    const recentBlockhashForSwap = await this.connection.getLatestBlockhash();
    const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean);

    if (useVersionedTransaction) {
        const versionedTransaction = new VersionedTransaction(
            new TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: recentBlockhashForSwap.blockhash,
                instructions: instructions,
            }).compileToV0Message()
        );
        versionedTransaction.sign([this.wallet.payer]);
        return versionedTransaction;
    }

    const legacyTransaction = new Transaction({
        blockhash: recentBlockhashForSwap.blockhash,
        lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
        feePayer: this.wallet.publicKey,
    });

    legacyTransaction.add(...instructions);
    return legacyTransaction;
}

async sendLegacyTransaction(tx: any, maxRetries:any) {
    const txid = await this.connection.sendTransaction(tx, [this.wallet.payer], {
        skipPreflight: true,
        maxRetries: maxRetries,
    });

    return txid;
}

async sendVersionedTransaction(tx:any, maxRetries:any) {
    const txid = await this.connection.sendTransaction(tx, {
        skipPreflight: true,
        maxRetries: maxRetries,
    });

    return txid;
}

async simulateLegacyTransaction(tx:any) {
    const txid = await this.connection.simulateTransaction(tx, [this.wallet.payer]);
    return txid;
}

async simulateVersionedTransaction(tx:any) {
    const txid = await this.connection.simulateTransaction(tx);
    return txid;
}

getTokenAccountByOwnerAndMint(mint:any) {
    return {
        programId: TOKEN_PROGRAM_ID,
        pubkey: PublicKey.default,
        accountInfo: {
            mint: mint,
            amount: 0,
        },
    };
}

async calcAmountOut(poolKeys:any, rawAmountIn:any, swapInDirection:any) {
    const poolInfo = await Liquidity.fetchInfo({ connection: this.connection, poolKeys });

    let currencyInMint = poolKeys.baseMint;
    let currencyInDecimals = poolInfo.baseDecimals;
    let currencyOutMint = poolKeys.quoteMint;
    let currencyOutDecimals = poolInfo.quoteDecimals;

    if (!swapInDirection) {
        currencyInMint = poolKeys.quoteMint;
        currencyInDecimals = poolInfo.quoteDecimals;
        currencyOutMint = poolKeys.baseMint;
        currencyOutDecimals = poolInfo.baseDecimals;
    }

    const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals);
    const amountIn = new TokenAmount(currencyIn, rawAmountIn, false);
    const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals);
    const slippage = new Percent(5, 100);

    const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = Liquidity.computeAmountOut({
        poolKeys,
        poolInfo,
        amountIn,
        currencyOut,
        slippage,
    });

    return { amountIn, amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee };
}
}

export default RaydiumSwap