import mongoose, { Schema, Document } from 'mongoose';

// Chats model
export interface IChat extends Document {
    id: string;
    chat_id: string;
    username: string;
    creation_date: Date;
    message_count: { type: Number, default: 0 }
    token_count: { type: Number, default: 0 },
}
const ChatSchema: Schema = new Schema({
    chat_id: { type: String, required: true, unique: true },
    username: { type: String, default: null },
    message_count: { type: Number, default: 0 },
    token_count: { type: Number, default: 0 },
    creation_date: { type: Date, default: Date.now },
});

export const Chat = mongoose.model<IChat>('Chat', ChatSchema);
