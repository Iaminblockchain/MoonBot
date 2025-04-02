import mongoose, { Schema, Document } from 'mongoose';

// Call model
export interface ICall extends Document {
    id: string;
    chat_id: string;
    token_id: string;
    message_date: Date;
    creation_date: Date;
}

const CallSchema: Schema = new Schema({
    id: { type: String, required: true, unique: true },
    chat_id: { type: String, required: true },
    token_id: { type: String, required: true },
    message_date: { type: Date, required: true },
    creation_date: { type: Date, default: Date.now },
});

export const Call = mongoose.model<ICall>('Call', CallSchema);