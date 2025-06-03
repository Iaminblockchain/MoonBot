// Import necessary modules and functions
import { getTx, extractTransactionMetrics } from "../src/solana/txhelpers";
import * as dotenv from "dotenv";

// Mock mongoose before any other imports
jest.mock("mongoose", () => ({
    Schema: jest.fn(),
    model: jest.fn(),
    connect: jest.fn(),
    connection: {
        readyState: 1,
    },
}));

dotenv.config();

describe("getTxInfo", () => {
    const txsig1 = "3Prpzq4yrrh94n6v5Q6YdoYbjjy47LRokBBYoqQV4guYcVGZ7xVZER6qNgfM7THVAMGbttjinpCnxnRfAHb45Nsw";
    const txsig2 = "5JQ1Wm2TKaSp8PFxDG4yApBERQGEcYJ47mXc1yPtcW3dYJ7oTWCyvjEMg4L2ev1YpR6yfjVfA67enpeTCb64xYfh";
    const tokenMint1 = "UASnrvAChQ1FSFvU25Mz3Am6sYgCt4bcr4pXQJ7pump";
    const tokenMint2 = "GZXM8VD6zcPVAeimvNrfz6tajZuohTeghDiu1DkDpump";

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
    });

    it("should return transaction info when transaction is found", async () => {
        console.log("SOLANA_RPC_ENDPOINT:", process.env.solana_rpc_endpoint);
        let url = process.env.solana_rpc_endpoint || "https://api.mainnet-beta.solana.com";
        const tx = await getTx(url, txsig1);
        expect(tx).toBeDefined();
        expect(tx).toHaveProperty("transaction");
        expect(tx.blockTime).toBeGreaterThan(0);

        const metrics = extractTransactionMetrics(tx, tokenMint1);

        expect(metrics).toBeDefined();
        expect(metrics).toHaveProperty("owner_pubkey");
        expect(metrics).toHaveProperty("token");
        expect(metrics).toHaveProperty("token_balance_change");
        expect(metrics).toHaveProperty("transaction_fee");
        expect(metrics).toHaveProperty("sol_balance_change");
        expect(metrics).toHaveProperty("token_creation_cost");
        // expect(metrics.sol_balance_change).toBeGreaterThan(0);
        // expect(metrics.token_balance_change).toBeGreaterThan(0);
    });

    it("should return transaction info when transaction is found", async () => {
        console.log("SOLANA_RPC_ENDPOINT:", process.env.solana_rpc_endpoint);
        let url = process.env.solana_rpc_endpoint || "https://api.mainnet-beta.solana.com";
        const tx = await getTx(url, txsig2);
        expect(tx).toBeDefined();
        expect(tx).toHaveProperty("transaction");
        expect(tx.blockTime).toBeGreaterThan(0);

        const metrics = extractTransactionMetrics(tx, tokenMint2);

        expect(metrics).toBeDefined();
        expect(metrics).toHaveProperty("owner_pubkey");
        expect(metrics).toHaveProperty("token");
        expect(metrics).toHaveProperty("token_balance_change");
        expect(metrics).toHaveProperty("transaction_fee");
        expect(metrics).toHaveProperty("sol_balance_change");
        expect(metrics).toHaveProperty("token_creation_cost");

        // Add null check before accessing properties
        if (metrics) {
            expect(metrics.sol_balance_change).toBeGreaterThan(0);
            expect(metrics.token_balance_change).toBeGreaterThan(0);
        }
    });
});
