// Mock process.exit
const originalExit = process.exit;
process.exit = ((code?: number | string | null) => {
    if (code === 1) {
        // Don't actually exit during tests
        return;
    }
    originalExit(code);
}) as typeof process.exit;

// Mock environment variables
process.env.solana_rpc_endpoint = "https://api.mainnet-beta.solana.com";
process.env.solana_wss_endpoint = "wss://api.mainnet-beta.solana.com";
process.env.mongo_url = "mongodb://localhost:27017/test";
process.env.telegram_bot_token = "test-token";
process.env.telegram_api_id = "12345";
process.env.telegram_api_hash = "test-hash";
process.env.telegram_string_session = "test-session";
process.env.fee_collection_wallet = "test-wallet";
process.env.setup_bot = "false";
process.env.setup_scrape = "false";
process.env.start_endpoint_enabled = "false";

// Mock server initialization
jest.mock("./src/index", () => ({
    main: jest.fn().mockResolvedValue(true),
    SOLANA_CONNECTION: {
        getLatestBlockhash: jest.fn(),
        getAccountInfo: jest.fn(),
    },
}));

// Mock mongoose
jest.mock("mongoose", () => ({
    connect: jest.fn().mockResolvedValue(true),
    connection: {
        readyState: 1,
        close: jest.fn().mockResolvedValue(true),
    },
}));

// Mock Telegram client
jest.mock("telegram", () => ({
    TelegramClient: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(true),
        disconnect: jest.fn().mockResolvedValue(true),
        getDialogs: jest.fn().mockResolvedValue([]),
    })),
}));
