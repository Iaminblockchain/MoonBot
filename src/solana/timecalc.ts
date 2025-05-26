export interface TimingMetrics {
    startTime: number;
    priceCheckTime: number;
    walletFetchTime: number;
    balanceCheckTime: number;
    swapStartTime: number;
    swapEndTime: number;
    metadataFetchTime: number;
    messageSendTime: number;
    endTime: number;
    intervals: {
        priceCheckDuration: number;
        walletFetchDuration: number;
        balanceCheckDuration: number;
        swapDuration: number;
        metadataFetchDuration: number;
        messageSendDuration: number;
        totalDuration: number;
    };
}

/**
 * Creates a new TimingMetrics object with initial values
 * @returns A new TimingMetrics object with startTime set to current timestamp
 */
export function createTimingMetrics(): TimingMetrics {
    return {
        startTime: Date.now(),
        priceCheckTime: 0,
        walletFetchTime: 0,
        balanceCheckTime: 0,
        swapStartTime: 0,
        swapEndTime: 0,
        metadataFetchTime: 0,
        messageSendTime: 0,
        endTime: 0,
        intervals: {
            priceCheckDuration: 0,
            walletFetchDuration: 0,
            balanceCheckDuration: 0,
            swapDuration: 0,
            metadataFetchDuration: 0,
            messageSendDuration: 0,
            totalDuration: 0,
        },
    };
}

/**
 * Calculates the time intervals between different stages of a transaction
 * @param metrics The TimingMetrics object to calculate intervals for
 * @returns The updated TimingMetrics object with calculated intervals
 */
export function calculateIntervals(metrics: TimingMetrics): TimingMetrics {
    const intervals = {
        priceCheckDuration: metrics.priceCheckTime - metrics.startTime,
        walletFetchDuration: metrics.walletFetchTime - metrics.priceCheckTime,
        balanceCheckDuration: metrics.balanceCheckTime - metrics.walletFetchTime,
        swapDuration: metrics.swapEndTime - metrics.swapStartTime,
        metadataFetchDuration: metrics.metadataFetchTime - metrics.swapEndTime,
        messageSendDuration: metrics.messageSendTime - metrics.metadataFetchTime,
        totalDuration: metrics.endTime - metrics.startTime,
    };

    return {
        ...metrics,
        intervals,
    };
}
