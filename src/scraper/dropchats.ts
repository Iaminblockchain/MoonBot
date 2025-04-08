import mongoose from 'mongoose';
import { Chat } from '../models/chatModel';
import { logger } from '../util';
import { retrieveEnvVariable } from '../config';
const MONGO_URI = retrieveEnvVariable("mongo_url");

export async function dropAllChannels() {
    try {
        await mongoose.connect(MONGO_URI);
        logger.info('MongoDB connected');

        const result = await Chat.deleteMany({});
        logger.info(`Deleted ${result.deletedCount} channels`);

        process.exit(0);
    } catch (error) {
        logger.error('Error deleting all channels', error);
        process.exit(1);
    }
}

dropAllChannels();