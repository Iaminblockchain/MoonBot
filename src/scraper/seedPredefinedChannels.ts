import mongoose from 'mongoose';
import { Chat } from '../models/chatModel';
import { retrieveEnvVariable } from '../config';
import { logger } from '../util';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const MONGO_URI = retrieveEnvVariable("mongo_url");
const CSV_PATH = path.join(__dirname, '../../data/channels.csv');

export function getCSVRecords(): any[] {
    const CSV_PATH = path.join(__dirname, '../../data/channels.csv');
    const csvData = fs.readFileSync(CSV_PATH, 'utf-8');
    const records = parse(csvData, {
        columns: true,
        skip_empty_lines: true,
    });
    return records;
}

export async function seedPredefinedChannels() {
    try {
        await mongoose.connect(MONGO_URI);
        logger.info('MongoDB connected');

        const csvRecords = getCSVRecords();

        for (const channel of csvRecords) {
            const chat_id = channel.ID;
            const username = !channel.Username ? null : channel.Username;

            const exists = await Chat.findOne({ chat_id });
            if (!exists) {
                const newChat = new Chat({
                    id: uuidv4(),
                    chat_id: chat_id,
                    username: username,
                });
                await newChat.save();
                logger.info(`Inserted channel: ${username}`);
            } else {
                logger.info(`Channel already exists: ${username}`);
            }
        }

        logger.info('Finished seeding predefined channels');

    } catch (error) {
        logger.error('Error seeding predefined channels', error);
        process.exit(1);
    }
}
