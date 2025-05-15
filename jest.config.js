/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    setupFiles: ["<rootDir>/jest.setup.ts"],
    testMatch: ["**/tests/**/*.test.ts"],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
    },
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                tsconfig: "tsconfig.json",
            },
        ],
    },
    rootDir: ".",
    moduleDirectories: ["node_modules", "src"],
    testPathIgnorePatterns: ["/node_modules/", "/dist/"],
    globals: {
        "ts-jest": {
            isolatedModules: true,
        },
    },
};
