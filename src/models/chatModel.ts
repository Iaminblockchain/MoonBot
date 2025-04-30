import mongoose, { Schema, Document } from "mongoose";

export interface IChat extends Document {
    chat_id: string;
    username: string;
    creation_date: Date;
    title: string | null;
}

const ChatSchema: Schema = new Schema({
    chat_id: { type: String, required: true, unique: true },
    username: { type: String, default: null },
    creation_date: { type: Date, default: Date.now },
    title: { type: String, default: null },
});

export const Chat = mongoose.model<IChat>("Chat", ChatSchema);

export interface IChatStats extends Document {
    chat_id: string;
    message_count: number;
    token_count: number;
}

const ChatStatsSchema: Schema = new Schema({
    chat_id: { type: String, required: true, unique: true },
    message_count: { type: Number, default: 0 },
    token_count: { type: Number, default: 0 },
});

export const ChatStats = mongoose.model<IChatStats>("ChatStats", ChatStatsSchema);
