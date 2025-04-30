import mongoose, { Schema, model, Document } from "mongoose";
import { logger } from "../logger";

export interface IReferral extends Document {
    refereeId: string; // The ID of the referee
    referrers: (string | null)[]; // Array of up to 5 referrers, each can be null
    createdAt?: Date; // Timestamp of creation
}

const ReferralSchema: Schema = new Schema({
    refereeId: { type: String, required: true, unique: true }, // Referee's ID (unique)
    referrers: { type: [String], default: [null, null, null, null, null] }, // Array of up to 5 referrers
    createdAt: { type: Date, default: Date.now }, // Automatically set creation timestamp
});

export const Referral = model<IReferral>("Referral", ReferralSchema);

// Function to create a new referral relationship
export const createReferral = async (refereeId: string, referrers: (string | null)[]): Promise<IReferral | null> => {
    try {
        const referral = new Referral({ refereeId, referrers });
        return await referral.save();
    } catch (error) {
        logger.error("Error creating referral:", { error });
        return null;
    }
};

// Function to update the referrers for an existing referee
export const updateReferrers = async (refereeId: string, newReferrers: (string | null)[]): Promise<IReferral | null> => {
    try {
        return await Referral.findOneAndUpdate(
            { refereeId }, // Find by refereeId
            { referrers: newReferrers }, // Update the referrers array
            { new: true } // Return the updated document
        );
    } catch (error) {
        logger.error("Error updating referrers:", { error });
        return null;
    }
};

// Function to get a referral by refereeId
export const getReferralByRefereeId = async (refereeId: string): Promise<IReferral | null> => {
    try {
        return await Referral.findOne({ refereeId });
    } catch (error) {
        logger.error("Error fetching referral:", { error });
        return null;
    }
};
