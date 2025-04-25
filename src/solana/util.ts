import bs58 from "bs58";
import {
    Keypair,
    PublicKey,
} from "@solana/web3.js";
import { SOLANA_CONNECTION } from "..";
import { logger } from "../logger";

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

export async function getRandomValidator() {
    const res =
        jito_Validators[Math.floor(Math.random() * jito_Validators.length)];
    return new PublicKey(res);
}


export const getSolBalance = async (privateKey: string) => {
    try {
        let privateKey_nums = bs58.decode(privateKey);
        let keypair = Keypair.fromSecretKey(privateKey_nums);

        const accountInfo = await SOLANA_CONNECTION.getAccountInfo(keypair.publicKey);

        if (accountInfo && accountInfo.lamports)
            return Number(accountInfo.lamports) / 10 ** 9;
        else return 0;
    } catch (error) {
        logger.error({ error });
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
