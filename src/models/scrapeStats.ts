import mongoose, { Schema, Document } from 'mongoose';

// ScrapeStats model
export interface IScrapeStats extends Document {
    id: string;
    total_messages_read: number;
    contracts_found: number;
    unique_incoming_channel_count: number;
}

const ScrapeStatsSchema: Schema = new Schema({
    id: { type: String, required: true, unique: true },
    total_messages_read: { type: Number, default: 0 },
    unique_channel_count: { type: Number, default: 0 },
    contracts_found: { type: Number, default: 0 },
});

export const ScrapeStats = mongoose.model<IScrapeStats>('ScrapeStats', ScrapeStatsSchema);