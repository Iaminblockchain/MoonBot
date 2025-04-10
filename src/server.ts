import express from 'express';
import { logger } from './util';
import { Chat } from './models/chatModel';
import { Call } from './models/callModel';
import cors from 'cors';

export const setupServer = (port: number): Promise<void> => {
    const app = express();

    app.use(cors({ origin: 'http://localhost:3000' }));

    app.use(express.static('public'));

    app.get('/health', (_, res) => {
        res.status(200).send('OK');
    });

    app.get('/api/chats', async (_, res) => {
        try {
            const chats = await Chat.find({});
            res.json(chats);
        } catch (error) {
            logger.error('Failed to fetch chats', error);
            res.status(500).send('Error fetching chats');
        }
    });

    app.get('/api/calls', async (_, res) => {
        try {
            const calls = await Call.find({});
            res.json(calls);
        } catch (error) {
            logger.error('Failed to fetch calls', error);
            res.status(500).send('Error fetching calls');
        }
    });

    return new Promise<void>((resolve) => {
        app.listen(port, () => {
            logger.info(`Health check server listening on port ${port}`);
            resolve();
        });
    });
};