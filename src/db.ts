import mongoose, { Schema, model, Document } from 'mongoose';
import * as config from './config';
import TelegramBot from 'node-telegram-bot-api';

export const connect = async () => {
    try {
        await mongoose.connect(config.MONGO_URI);
        console.log('MongoDB connected');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
        return;
    }
}

