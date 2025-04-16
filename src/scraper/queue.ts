import Agenda, { Job } from 'agenda';
import { getTgClient } from './scraper';
import { joinChannelByName } from '../scraper/manageGroups';
import { logger } from '../util';
import { Chat } from '../models/chatModel';
import { processMessages } from './processMessages';
import { NewMessage } from 'telegram/events';

let agendaInstance: Agenda | null = null;

export function initJoinQueue(mongoUri: string) {
    agendaInstance = new Agenda({ db: { address: mongoUri, collection: 'joinChannelQueue' } });

    agendaInstance.define('join-channel', async (job: Job<{ username: string }>) => {
        const { username } = job.attrs.data;
        const client = await getTgClient();
        const dialogs = await client.getDialogs({});
        logger.info(`🎯 Processing join for: ${username}`);

        const { id, success } = await joinChannelByName(client, username, dialogs);

        if (success && id) {
            await Chat.updateOne(
                { chat_id: id },
                { chat_id: id, username },
                { upsert: true }
            );
            logger.info(`Chat ${username} saved to DB with id ${id}`);

            //listen to events from the chat
            client.addEventHandler(
                processMessages,
                new NewMessage({ chats: [id] })
            );
        } else {
            logger.warn(`⚠️ Failed to join or save chat: ${username}`);
        }
    });
}

export function getQueue(): Agenda {
    if (!agendaInstance) throw new Error("Agenda instance not initialized.");
    return agendaInstance;
}

export async function startJoinQueue() {
    await getQueue().start();
    logger.info('📌 joinChannelQueue started');
}

export async function queueJoinChannel(username: string) {
    await getQueue().now('join-channel', { username });
}