const { ethers } = require('ethers')
const { executeTradingStrategy } = require('./tradingLogic')
const { getPriceChanges, getAllPriceChanges, getChainIds, getTokenPrice } = require('./priceMonitor')

require('dotenv').config()
const INFURA_URL_MAINNET = process.env.INFURA_URL_MAINNET
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const WALLET_SECRET = process.env.WALLET_SECRET

console.log(INFURA_URL_MAINNET + "infur")

async function main() {
  try {
    console.log('Starting trading bot at ' + new Date().toISOString())
    console.log('Will execute trading strategy every 5 minutes')
    
/*
    try {
      const tokenprice = await getTokenPrice("base","0x20DD04c17AFD5c9a8b3f2cdacaa8Ee7907385BEF");
      console.log(tokenprice);
  } catch (error) {
      console.error('Error:', error.message);
  }*/
    // Run immediately on startup
    await executeTradingStrategy(WALLET_ADDRESS)
    
    // Then run every 15 minutes
    setInterval(async () => {
      try {
        console.log('\nExecuting trading strategy at ' + new Date().toISOString())
        await executeTradingStrategy(WALLET_ADDRESS)
      } catch (error) {
        console.error('Error in interval execution:', error.message)
      }
    }, 5 * 60 * 1000) // 15 minutes in milliseconds
  } catch (error) {
    console.error('Error in main:', error.message)
  }
}

main()