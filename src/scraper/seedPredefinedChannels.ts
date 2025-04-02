import mongoose from 'mongoose';
import { Chat } from '../models/chatModel';
import predefinedChannels from '../../channels_predefined.json';
import { retrieveEnvVariable } from '../config';
import { logger } from '../util';
import { v4 as uuidv4 } from 'uuid';

const MONGO_URI = retrieveEnvVariable("mongo_url");

async function seedPredefinedChannels() {
    try {
        await mongoose.connect(MONGO_URI);
        logger.info('MongoDB connected');

        for (const channel of predefinedChannels) {
            const exists = await Chat.findOne({ chat_id: channel }); // corrected here
            if (!exists) {
                const newChat = new Chat({
                    id: uuidv4(),
                    chat_id: channel
                });
                await newChat.save();
                logger.info(`Inserted channel: ${channel}`);
            } else {
                logger.info(`Channel already exists: ${channel}`);
            }
        }

        logger.info('Finished seeding predefined channels');
        process.exit(0);
    } catch (error) {
        logger.error('Error seeding predefined channels', error);
        process.exit(1);
    }
}

async function dropAllChannels() {
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

//dropAllChannels();
seedPredefinedChannels();