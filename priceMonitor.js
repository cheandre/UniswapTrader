const axios = require('axios');
const tokens = require('./tokens.json');
require('dotenv').config();

async function getPriceChanges(tokenSymbol) {
    const token = tokens[tokenSymbol];
    
    if (!token || !token.address) {
        throw new Error(`Token configuration or address not found for ${tokenSymbol}`);
    }

    try {
        const priceData = await getTokenPrice('base', token.address);
        
        // Extract the variations from the response and handle null values
        const priceChanges = [
            {
                timeframe: '5m',
                percentage: priceData.data.variation5m === null ? 0 : Number(priceData.data.variation5m.toFixed(2)),
                isPositive: priceData.data.variation5m === null ? true : priceData.data.variation5m >= 0
            },
            {
                timeframe: '1h',
                percentage: priceData.data.variation1h === null ? 0 : Number(priceData.data.variation1h.toFixed(2)),
                isPositive: priceData.data.variation1h === null ? true : priceData.data.variation1h >= 0
            },
            {
                timeframe: '6h',
                percentage: priceData.data.variation6h === null ? 0 : Number(priceData.data.variation6h.toFixed(2)),
                isPositive: priceData.data.variation6h === null ? true : priceData.data.variation6h >= 0
            },
            {
                timeframe: '24h',
                percentage: priceData.data.variation24h === null ? 0 : Number(priceData.data.variation24h.toFixed(2)),
                isPositive: priceData.data.variation24h === null ? true : priceData.data.variation24h >= 0
            }
        ];

        // Log all intervals for the token
        console.log(`\nPrice changes for ${tokenSymbol}:`);
        priceChanges.forEach(change => {
            console.log(`${change.timeframe}: ${change.percentage}% (${change.isPositive ? 'up' : 'down'})`);
        });

        return {
            symbol: tokenSymbol,
            name: token.name,
            priceChanges
        };
    } catch (error) {
        console.error(`Error fetching price changes for ${tokenSymbol}:`, error.message);
        throw error;
    }
}

async function getAllPriceChanges() {
    const results = [];
    
    for (const symbol of Object.keys(tokens)) {
        try {
            const priceData = await getPriceChanges(symbol);
            results.push(priceData);
            // Add a small delay between requests
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`Failed to get price changes for ${symbol}:`, error.message);
        }
    }
    
    return results;
}

async function getTokenPrice(chainId, address) {
    try {
        const response = await axios.get(
            `https://public-api.dextools.io/trial/v2/token/${chainId}/${address}/price`,
            {
                headers: {
                    'X-API-KEY': process.env.DEXTOOLSAPIKEY
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error('Error fetching token price:', error.message);
        throw error;
    }
}

async function getChainIds() {
    try {
        const response = await axios.get(
            'https://public-api.dextools.io/trial/v2/blockchain',
            {
                headers: {
                    'X-API-KEY': process.env.DEXTOOLSAPIKEY
                }
            }
        );
        console.log('Chain IDs:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error fetching chain IDs:', error.message);
        throw error;
    }
}

module.exports = {
    getPriceChanges,
    getAllPriceChanges,
    getChainIds,
    getTokenPrice
}; 