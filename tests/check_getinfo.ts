import { extractTransactionMetrics, getTx } from '../src/solana/txhelpers';
import { logger } from '../src/logger';

// Define the transaction signature
const txsig = "3Prpzq4yrrh94n6v5Q6YdoYbjjy47LRokBBYoqQV4guYcVGZ7xVZER6qNgfM7THVAMGbttjinpCnxnRfAHb45Nsw";
getTx(txsig).then(tx => {
    logger.info("Transaction Info:", tx);
    const tokenMint = "UASnrvAChQ1FSFvU25Mz3Am6sYgCt4bcr4pXQJ7pump";
    const metrics = extractTransactionMetrics(tx, tokenMint);
    logger.info("Transaction Metrics:", metrics);
}).catch(error => {
    console.error("Error:", error);
});

// // Call the function and log the result
// getTxInfo(txsig).then(result => {
// ("Transaction Info:", result);
// }).catch(error => {
//     logger.error("Error:", error);
// });