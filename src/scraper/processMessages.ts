import { ICall, Call } from "../models/callModel";
import { NewMessageEvent } from "telegram/events";
import { logger } from '../util';
import { v4 as uuidv4 } from 'uuid';
const axios = require('axios');

// Regex for contract addresses
const PUMP_FUN_CA_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

let totalCAFound = 0;
let totalMessagesRead = 0;

const trackedContracts: Set<string> = new Set();

async function trackPerformance(contractAddress: string, entry_price: string): Promise<void> {
    if (trackedContracts.has(contractAddress)) return;
    trackedContracts.add(contractAddress);

    const intervals = [
        { label: '1m', minutes: 1 },
        { label: '5m', minutes: 5 },
        { label: '15m', minutes: 15 },
        { label: '30m', minutes: 30 },
        { label: '60m', minutes: 60 }
    ];

    for (const { label, minutes } of intervals) {
        setTimeout(async () => {
            try {
                const currentPrice = await getTokenPrice(contractAddress);
                if (currentPrice && entry_price) {
                    const performance = ((parseFloat(currentPrice) - parseFloat(entry_price)) / parseFloat(entry_price)) * 100;
                    logger.info(`${label} performance for ${contractAddress}: ${performance.toFixed(2)}%`);

                    const updateField = `performance_${label}` as keyof ICall;
                    await Call.findOneAndUpdate(
                        { contract_address: contractAddress },
                        { [updateField]: performance },
                        { new: true }
                    );
                } else {
                    logger.warn(`No price available to calculate performance`, { label: label, contractAddress: contractAddress });
                }
            } catch (err) {
                logger.error(`Error checking performance for : ${err}`, { label: label, contractAddress: contractAddress });
            }
        }, minutes * 60 * 1000);
    }
}

async function getTokenPrice(
    ids: string,
    vsToken: string | null = null,
    showExtraInfo: boolean = false
): Promise<any> {
    try {
        const params: { ids: string; vsToken?: string; showExtraInfo?: boolean } = { ids };

        // Use showExtraInfo if true, otherwise use vsToken if provided
        if (showExtraInfo) {
            params.showExtraInfo = true;
        } else if (vsToken) {
            params.vsToken = vsToken;
        }

        const response = await axios.get('https://api.jup.ag/price/v2', { params });

        const priceData = response.data.data;

        // Extracting details
        for (const tokenId in priceData) {
            if (priceData.hasOwnProperty(tokenId)) {
                const tokenInfo = priceData[tokenId];
                logger.info('Price ', { token: tokenInfo.id, price: tokenInfo.price });
                return tokenInfo.price;
            }
        }

        logger.error("price not found")

    } catch (error) {
        logger.error('Error fetching price:', error);
        throw error;
    }
}

export async function contractFound(
    contractAddress: string,
    chat_id_str: string
): Promise<void> {
    logger.info("contract found ", { contractAddress: contractAddress, chat_id_str: chat_id_str });

    totalCAFound += 1;

    let entry_price;
    try {
        entry_price = await getTokenPrice(contractAddress);
        logger.info("price now ", { entry_price: entry_price });
    } catch (err) {
        logger.error("error getting price ", { contractAddress: contractAddress });
    }
    if (entry_price) {
        try {
            const callRecord = new Call({
                id: uuidv4(),
                chat_id: chat_id_str,
                contract_address: contractAddress,
                entry_price: entry_price,
                message_date: new Date(),
            });
            await callRecord.save();
            logger.info("Saved call record", { chat_id_str: chat_id_str, contractAddress: contractAddress })

            //start tracking
            trackPerformance(contractAddress, entry_price);
        } catch (err) {
            logger.error(`Error saving call record: ${err}`);
        }
    } else {
        logger.error('no entry price');
    }

}

export async function processMessages(event: NewMessageEvent): Promise<void> {

    try {
        const messageText = event.message.text || "";
        const chatid = event.message.senderId;
        if (!chatid) return;
        logger.info("message " + messageText + " " + chatid);

        totalMessagesRead++;
        logger.info("stats. total messages " + totalMessagesRead + " CAs: " + totalCAFound);

        const numericId = chatid.toJSNumber();
        const chat_id_str = String(numericId);

        logger.info(`process message from  ${chatid}`);

        //note: matching several CAs not just one
        const contractAddresses = messageText.match(PUMP_FUN_CA_REGEX) || [];

        if (contractAddresses.length > 0) {
            let contractAddress = contractAddresses[0] || '';
            logger.info(`Detected contract address: ${contractAddress}`);
            await contractFound(contractAddress, chat_id_str);
        }
    } catch (e) {
        logger.error(`Error processing message: ${e}`);
    }
}