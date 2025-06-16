const { ethers } = require('ethers')
const { executeTradingStrategy } = require('./tradingLogic')

require('dotenv').config()
const INFURA_URL_MAINNET = process.env.INFURA_URL_MAINNET
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const WALLET_SECRET = process.env.WALLET_SECRET

console.log(INFURA_URL_MAINNET + "infur")

async function main() {
  try {
    console.log('Starting trading bot at ' + new Date().toISOString())
    console.log('Will execute trading strategy every 15 minutes')
    
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
    }, 15 * 60 * 1000) // 15 minutes in milliseconds
  } catch (error) {
    console.error('Error in main:', error.message)
  }
}

main()