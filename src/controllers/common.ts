export const userFriendlyError = (error: unknown): string => {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (msg.includes("insufficient") || msg.includes("balance")) {
        return "Buy failed: insufficient balance";
    } else {
        return "Buy failed due to an error";
    }
};
