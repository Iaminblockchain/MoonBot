import RaydiumSwap from './raydiumSwap';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { SOLANA_RPC_ENDPOINT } from '.';

// import 'dotenv/config';
// import { swapConfig } from './swapConfig'; // Import the configuration

/**
 * Performs a token swap on the Raydium protocol.
 * Depending on the configuration, it can execute the swap or simulate it.
 */
const swap: any = async (swapConfig: any, privateKey: any) => {
  /**
   * The RaydiumSwap instance for handling swaps.
   */
  try {

    const raydiumSwap = new RaydiumSwap(SOLANA_RPC_ENDPOINT, privateKey);

    console.log(`Raydium swap initialized`);
    console.log(`Swapping ${swapConfig.tokenAAmount} of ${swapConfig.tokenAAddress} for ${swapConfig.tokenBAddress}...`)
  
    /**
     * Load pool keys from the Raydium API to enable finding pool information.
     */
    await raydiumSwap.loadPoolKeys(swapConfig.pool);
    console.log(`Loaded pool keys`);
  
    /**
     * Find pool information for the given token pair.
     */
    const poolInfo: any = raydiumSwap.findPoolInfoForTokens(swapConfig.tokenAAddress, swapConfig.tokenBAddress);
    if (!poolInfo) {
      console.error('Pool info not found');
      return 'Pool info not found';
    } else {
      console.log('Found pool info');
    }
  
    /**
     * Prepare the swap transaction with the given parameters.
     */
    console.log("Swapping initialized", `  - Date:${new Date()}`);
    const tx = await raydiumSwap.getSwapTransaction(
      swapConfig.tokenBAddress,
      swapConfig.tokenAAmount,
      poolInfo,
      swapConfig.maxLamports, 
      swapConfig.useVersionedTransaction,
      swapConfig.direction
    );
  console.log("Swapping transaction prepared", `  - Date:${new Date()}`);

  
    /**
     * Depending on the configuration, execute or simulate the swap.
     */
    if (swapConfig.executeSwap) {
      /**
       * Send the transaction to the network and log the transaction ID.
       */
      const txid = swapConfig.useVersionedTransaction
        ? await raydiumSwap.sendVersionedTransaction(tx as VersionedTransaction, swapConfig.maxRetries)
        : await raydiumSwap.sendLegacyTransaction(tx as Transaction, swapConfig.maxRetries);
  
        console.log(`Transaction successful: https://solscan.io/tx/${txid}`, `  - Date:${new Date()}`);    
      return {
        confirmed: true,
        signature: txid,        
      };
  
    } else {
      /**
       * Simulate the transaction and log the result.
       */
      const simRes = swapConfig.useVersionedTransaction
        ? await raydiumSwap.simulateVersionedTransaction(tx as VersionedTransaction)
        : await raydiumSwap.simulateLegacyTransaction(tx as Transaction);
  
        console.log("Simulation Result:", simRes, `  - Date:${new Date()}`);
      return {
        confirmed: true,
        signature: simRes
      };
    }
  } catch(e){
    console.log("Error while swapping", e);
    return {
      confirmed: false,
      signature: null
    };
  }
};
export default swap;