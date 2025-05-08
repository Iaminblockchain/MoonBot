// Import necessary modules and functions
import { Connection } from "@solana/web3.js";
import { getTx, extractTransactionMetrics } from "../src/solana/txhelpers";
import * as dotenv from "dotenv";
dotenv.config();


describe("getTxInfo", () => {
    const txsig = "3Prpzq4yrrh94n6v5Q6YdoYbjjy47LRokBBYoqQV4guYcVGZ7xVZER6qNgfM7THVAMGbttjinpCnxnRfAHb45Nsw";
    const tokenMint = "UASnrvAChQ1FSFvU25Mz3Am6sYgCt4bcr4pXQJ7pump";

    beforeEach(() => {

    });

    it("should return transaction info when transaction is found", async () => {
        console.log("SOLANA_RPC_ENDPOINT:", process.env.solana_rpc_endpoint);
        let url = process.env.solana_rpc_endpoint || "https://api.mainnet-beta.solana.com";
        const tx = await getTx(url, txsig);
        expect(tx).toBeDefined();
        expect(tx).toHaveProperty("transaction");
        expect(tx.blockTime).toBeGreaterThan(0);

        const tokenMint = "UASnrvAChQ1FSFvU25Mz3Am6sYgCt4bcr4pXQJ7pump";
        const metrics = extractTransactionMetrics(tx, tokenMint);

        expect(metrics).toBeDefined();
        expect(metrics).toHaveProperty("owner_pubkey");
        expect(metrics).toHaveProperty("token");
        expect(metrics).toHaveProperty("token_balance_change");
        expect(metrics).toHaveProperty("transaction_fee");
        expect(metrics).toHaveProperty("sol_balance_change");
        expect(metrics).toHaveProperty("token_creation_cost");
        expect(metrics.sol_balance_change).toBeGreaterThan(0);
        expect(metrics.token_balance_change).toBeGreaterThan(0);

    });

    it("should return null when transaction is not found after max retries", async () => {

    });
}); 