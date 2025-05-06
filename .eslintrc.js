module.exports = {
    env: {
        node: true,
        es2021: true,
    },
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    plugins: [
        '@typescript-eslint',
        'unused-imports',
    ],
    rules: {
        'no-extra-semi': 'off',
        '@typescript-eslint/no-explicit-any': 'error',
        "@typescript-eslint/explicit-function-return-type": "off",
        'prefer-const': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'unused-imports/no-unused-imports': 'off',
        'unused-imports/no-unused-vars': [
            'off',
            { 'vars': 'all', 'varsIgnorePattern': '^_', 'args': 'after-used', 'argsIgnorePattern': '^_' }
        ],
        'no-var': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        'no-prototype-builtins': 'off',
        '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
        'no-dupe-else-if': 'off',
        'no-empty': 'off',
        '@typescript-eslint/ban-types': 'off',
        "@typescript-eslint/explicit-function-return-type": "off"
    },
    overrides: [
        {
            files: [
                'src/bot.ts',
                'src/controllers/autoBuyController.ts',
                'src/controllers/buyController.ts',
                'src/controllers/copytradeController.ts',
                'src/controllers/portfolioController.ts',
                'src/controllers/sellController.ts',
                'src/controllers/withdrawController.ts',
                'src/models/copyTradeModel.ts',
                'src/raydiumSwap.ts',
                'src/scraper/manageGroups.ts',
                // 'src/solana/trade.ts',
                'src/solana/txhelpers.ts',
            ],
            rules: {
                '@typescript-eslint/no-explicit-any': 'off'
            }
        }
    ],
    ignorePatterns: ['!src/**/*'],
}; 