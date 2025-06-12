const { ethers } = require('ethers')
const { executeTradingStrategy } = require('./tradingLogic')

require('dotenv').config()
const INFURA_URL_MAINNET = process.env.INFURA_URL_MAINNET
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const WALLET_SECRET = process.env.WALLET_SECRET

console.log(INFURA_URL_MAINNET + "infur")

async function main() {
  try {
    // Execute trading strategy
    await executeTradingStrategy(WALLET_ADDRESS)
  } catch (error) {
    console.error('Error in main:', error.message)
  }
}

main()