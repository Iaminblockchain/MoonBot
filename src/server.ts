import express from 'express';
import { logger } from './util';
import { ScrapeStats } from './models/scrapeStats';
import { Chat } from './models/chatModel';

import path from 'path';


export const setupServer = (port: number): Promise<void> => {
    const app = express();

    app.get('/health', (_, res) => {
        res.status(200).send('OK');
    });

    app.get('/api/stats', async (_, res) => {
        try {
            const stats = await ScrapeStats.findOne({});
            const totalChannels = await Chat.countDocuments();
            if (stats) {
                res.json({
                    ...stats.toObject(),
                    total_channels: totalChannels
                });
            } else {
                res.status(500).send('Error fetching stats');
            }
        } catch (error) {
            logger.error('Failed to fetch scrape stats', error);
            res.status(500).send('Error fetching stats');
        }
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

    return new Promise<void>((resolve) => {
        app.listen(port, () => {
            logger.info(`Health check server listening on port ${port}`);
            resolve();
        });
    });
};