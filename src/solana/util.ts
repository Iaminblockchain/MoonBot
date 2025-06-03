import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";
import { SOLANA_CONNECTION } from "..";
import { logger } from "../logger";

export const getSolBalance = async (privateKey: string) => {
    try {
        let privateKey_nums = bs58.decode(privateKey);
        let keypair = Keypair.fromSecretKey(privateKey_nums);

        const accountInfo = await SOLANA_CONNECTION.getAccountInfo(keypair.publicKey);

        if (accountInfo && accountInfo.lamports) return Number(accountInfo.lamports) / 10 ** 9;
        else return 0;
    } catch (error) {
        logger.error(`Error getting SOL balance: ${error instanceof Error ? error.message : String(error)}`);
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

export const getKeypair = (privateKey: string) => {
    // Decode the base58 private key into Uint8Array
    const secretKeyUint8Array = new Uint8Array(bs58.decode(privateKey));

    // Create a Keypair from the secret key
    const keypair = Keypair.fromSecretKey(secretKeyUint8Array);

    // Return the public key as a string
    return keypair;
};

export const formatPrice = (price: number): string => {
    // Convert to fixed string with 9 decimals and remove trailing zeros
    const formatted = price.toFixed(9);
    // Remove trailing zeros after decimal point
    return formatted.replace(/\.?0+$/, "");
};
