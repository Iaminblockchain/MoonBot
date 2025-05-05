import { getTokenPrice } from '../src/getPrice';

describe('getTokenPrice', () => {
    it('should fetch and return token price', async () => {
        const tokenAddress = 'So11111111111111111111111111111111111111112';

        const price = await getTokenPrice(tokenAddress);

        expect(price).toBeGreaterThan(0);
    });

    it('should fetch price for another token', async () => {
        const tokenAddress = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
        const price = await getTokenPrice(tokenAddress);

        expect(price).toBeGreaterThan(0);
    });
}); 