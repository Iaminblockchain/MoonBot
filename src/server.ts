import express from 'express';
import { logger } from './logger';
import { Chat } from './models/chatModel';
import { Call } from './models/callModel';
import cors from 'cors';
import { ALLOWED_ORIGIN } from '.';
import { client } from './index';
import { botInstance } from './bot';
import mongoose from 'mongoose';

export const setupServer = (
    app: express.Application,
    port: number,
    startEndpointEnabled = false,
    isServicesStarted = () => false
): Promise<void> => {
    const health_endpoint = '/health';

    logger.info("Will setup cors with allowed origin", { allowedOrigin: ALLOWED_ORIGIN });

    app.use((req, res, next) => {
        if (req.path === health_endpoint) {
            return next();
        }
        return cors({ origin: ALLOWED_ORIGIN })(req, res, next);
    });

    app.use(express.static('public'));
    app.use(express.json());

    app.get(health_endpoint, (_, res) => {
        res.status(200).send('OK');
    });

    // Services check middleware for API endpoints
    const checkServicesStarted = (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (!startEndpointEnabled || isServicesStarted()) {
            return next();
        }

        return res.status(503)
            .header('Retry-After', '60')
            .json({ error: 'Services not started yet. Call /start to initialize services.' });
    };

    app.get('/api/chats', checkServicesStarted, async (_, res) => {
        try {
            const chats = await Chat.find({});
            res.json(chats);
        } catch (error) {
            logger.error('Failed to fetch chats', error);
            res.status(500).json({ error: 'Error fetching chats' });
        }
    });

    app.get('/api/calls', checkServicesStarted, async (_, res) => {
        try {
            const calls = await Call.find({});
            res.json(calls);
        } catch (error) {
            logger.error('Failed to fetch calls', error);
            res.status(500).json({ error: 'Error fetching calls' });
        }
    });

    app.get('/services', (_, res) => {
        const telegramConnected = client?.connected || false;
        const botPolling = botInstance?.isPolling() || false;
        const mongoConnected = mongoose.connection.readyState === 1;

        const allServicesHealthy = telegramConnected && botPolling && mongoConnected;

        if (allServicesHealthy) {
            res.status(200).json({
                status: 'healthy',
                services: {
                    telegram: 'connected',
                    bot: 'polling',
                    mongodb: 'connected'
                }
            });
        } else {
            res.status(503).json({
                status: 'unhealthy',
                services: {
                    telegram: telegramConnected ? 'connected' : 'disconnected',
                    bot: botPolling ? 'polling' : 'not polling',
                    mongodb: mongoConnected ? 'connected' : 'disconnected'
                }
            });
        }
    });

    return new Promise<void>((resolve) => {
        app.listen(port, () => {
            logger.info(`Server listening on port ${port}`);
            resolve();
        });
    });
};