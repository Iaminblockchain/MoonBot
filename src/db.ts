import mongoose from 'mongoose';
import { MONGO_URI } from '.';

export const connect = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB connected');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
        return;
    }
}

