const { ethers } = require('ethers')
const ERC20ABI = require('./abi.json')
const tokens = require('./tokens.json')

require('dotenv').config()
const INFURA_URL_MAINNET = process.env.INFURA_URL_MAINNET
const provider = new ethers.JsonRpcProvider(INFURA_URL_MAINNET)

async function getTokenBalance(address) {
  const balances = []
  
  // Loop through all tokens in the configuration
  for (const [symbol, token] of Object.entries(tokens)) {
    const tokenContract = new ethers.Contract(
      token.address,
      ERC20ABI,
      provider
    )

    const balance = await tokenContract.balanceOf(address)
    const formattedBalance = ethers.formatUnits(balance, token.decimals)
    
    console.log(`\nBalance for ${symbol}:`)
    console.log(`Address: ${address}`)
    console.log(`Raw balance: ${balance}`)
    console.log(`Formatted balance: ${formattedBalance} ${symbol}`)
    
    balances.push({
      symbol,
      rawBalance: balance,
      formattedBalance: formattedBalance,
      name: token.name,
      address: token.address
    })
  }
  
  return balances
}

async function getSingleTokenBalance(tokenSymbol, address) {
  // Get token information from the configuration
  const token = tokens[tokenSymbol]
  
  if (!token) {
    throw new Error(`Token configuration not found for ${tokenSymbol}`)
  }

  const tokenContract = new ethers.Contract(
    token.address,
    ERC20ABI,
    provider
  )

  const balance = await tokenContract.balanceOf(address)
  const formattedBalance = ethers.formatUnits(balance, token.decimals)
  
  console.log(`\nBalance for ${tokenSymbol}:`)
  console.log(`Address: ${address}`)
  console.log(`Raw balance: ${balance}`)
  console.log(`Formatted balance: ${formattedBalance} ${tokenSymbol}`)
  
  return {
    symbol: tokenSymbol,
    rawBalance: balance,
    formattedBalance: formattedBalance,
    name: token.name,
    address: token.address
  }
}

module.exports = {
  getTokenBalance,
  getSingleTokenBalance
} 