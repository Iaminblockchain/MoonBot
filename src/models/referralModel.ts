import mongoose, { Schema, model, Document } from "mongoose";
import { logger } from "../logger";

export interface IReferral extends Document {
    refereeId: string; // The ID of the referee
    referrers: (string | null)[]; // Array of up to 5 referrers, each can be null
    rewards: number; // Total rewards received in lamports
    createdAt?: Date; // Timestamp of creation
}

const ReferralSchema: Schema = new Schema({
    refereeId: { type: String, required: true, unique: true }, // Referee's ID (unique)
    referrers: { type: [String], default: [null, null, null, null, null] }, // Array of up to 5 referrers
    rewards: { type: Number, default: 0 }, // Total rewards in lamports, default 0
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

// Function to get total rewards for a referee
export const getRewards = async (refereeId: string): Promise<number> => {
    try {
        const referral = await Referral.findOne({ refereeId });
        return referral?.rewards || 0;
    } catch (error) {
        logger.error("Error getting rewards:", { error });
        return 0;
    }
};

// Function to save (replace) rewards for a referee
export const saveRewards = async (refereeId: string, rewards: number): Promise<boolean> => {
    try {
        if (rewards < 0) {
            logger.error("Invalid rewards amount:", { rewards });
            return false;
        }
        await Referral.findOneAndUpdate({ refereeId }, { rewards }, { new: true });
        return true;
    } catch (error) {
        logger.error("Error saving rewards:", { error });
        return false;
    }
};

// Function to update (add to) rewards for a referee
export const updateRewards = async (refereeId: string, additionalRewards: number): Promise<boolean> => {
    try {
        if (additionalRewards < 0) {
            logger.error("Invalid additional rewards amount:", { additionalRewards });
            return false;
        }
        await Referral.findOneAndUpdate({ refereeId }, { $inc: { rewards: additionalRewards } }, { new: true });
        return true;
    } catch (error) {
        logger.error("Error updating rewards:", { error });
        return false;
    }
};
