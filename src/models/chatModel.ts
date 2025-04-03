import mongoose, { Schema, Document } from 'mongoose';

// Chats model
export interface IChat extends Document {
    id: string;
    chat_id: string;
    creation_date: Date;
    message_count: { type: Number, default: 0 }
    token_count: { type: Number, default: 0 },
}

const ChatSchema: Schema = new Schema({
    chat_id: { type: String, required: true, unique: true },
    creation_date: { type: Date, default: Date.now },
});

export const Chat = mongoose.model<IChat>('Chat', ChatSchema);


// ChatStatistics model
// export interface IChatStatistics extends Document {
//     creation: Date;
//     update: Date;
//     id: string;
//     tokencount: number;
// }

// const ChatStatisticsSchema: Schema = new Schema({
//     creation: { type: Date, default: Date.now },
//     update: { type: Date, default: Date.now },
//     id: { type: String, required: true, unique: true },
//     tokencount: { type: Number, default: 0 },
//     message_count: { type: Number, default: 0 }
// });

// export const ChatStatistics = mongoose.model<IChatStatistics>('ChatStatistics', ChatStatisticsSchema);