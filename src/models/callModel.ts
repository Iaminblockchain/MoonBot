import mongoose, { Schema, Document } from "mongoose";

export interface ICall extends Document {
    id: string;
    chat_id: string;
    contract_address: string;
    message_date: Date;
    creation_date: Date;
    entry_price?: number;
    performance_1m?: number;
    performance_5m?: number;
    performance_15m?: number;
    performance_30m?: number;
    performance_60m?: number;
}

const CallSchema: Schema = new Schema({
    id: { type: String, required: true, unique: true },
    chat_id: { type: String, required: true },
    contract_address: { type: String, required: true },
    message_date: { type: Date, required: true },
    creation_date: { type: Date, default: Date.now },
    entry_price: { type: Number }, // float
    performance_1m: { type: Number },
    performance_5m: { type: Number },
    performance_15m: { type: Number },
    performance_30m: { type: Number },
    performance_60m: { type: Number },
});

export const Call = mongoose.model<ICall>("Call", CallSchema);
