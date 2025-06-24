const { ethers } = require('ethers')
const { executeTradingStrategy2 } = require('./tradingLogic')
const { getPriceChanges, getAllPriceChanges, getChainIds, getTokenPrice } = require('./priceMonitor')

require('dotenv').config()
const INFURA_URL_MAINNET = process.env.INFURA_URL_MAINNET
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const WALLET_SECRET = process.env.WALLET_SECRET

const FIVE_MINUTES = 5 * 60 * 1000;
const TWENTY_MINUTES = 20 * 60 * 1000;

let waitTime = FIVE_MINUTES;

async function runStrategy() {
  try {
    console.log(`\nExecuting trading strategy at ${new Date().toISOString()}`);
    const swapped = await executeTradingStrategy2(WALLET_ADDRESS);
    if (swapped) {
      console.log('A swap was made. Waiting 20 minutes for the next run.');
      waitTime = TWENTY_MINUTES;
    } else {
      console.log('No swap was made. Waiting 5 minutes for the next run.');
      waitTime = FIVE_MINUTES;
    }
  } catch (error) {
    console.error('Error in strategy execution:', error.message);
    waitTime = FIVE_MINUTES; // Default to 5 mins on error
  } finally {
    setTimeout(runStrategy, waitTime);
  }
}

async function main() {
  try {
    console.log('Starting trading bot at ' + new Date().toISOString());
    runStrategy(); // Start the first run
  } catch (error) {
    console.error('Error in main:', error.message);
  }
}

main()