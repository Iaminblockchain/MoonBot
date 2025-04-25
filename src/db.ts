import mongoose from 'mongoose';
import { MONGO_URI } from '.';
import { logger } from './util';

export const connect = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        logger.info('MongoDB connected');
    } catch (error) {
        logger.error('MongoDB connection error:', error);
        process.exit(1);
        return;
    }
}

