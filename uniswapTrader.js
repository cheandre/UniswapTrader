const { ethers } = require('ethers')
const { abi: IUniswapv3PoolABI } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json')
const { abi: SwapRouterABI } = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json')
const { abi: FactoryABI } = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json')
const { getPoolImmutables, getPoolState } = require('./helpers')
const { findPool } = require('./poolUtils')
const ERC20ABI = require('./abi.json')
const tokens = require('./tokens.json')
const { getPriceChanges, getAllPriceChanges } = require('./priceMonitor')

require('dotenv').config()
const INFURA_URL_MAINNET = process.env.INFURA_URL_MAINNET
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const WALLET_SECRET = process.env.WALLET_SECRET

console.log(INFURA_URL_MAINNET + "infur")

const provider = new ethers.JsonRpcProvider(INFURA_URL_MAINNET)
const swapRouterAddress = '0x2626664c2603336E57B271c5C0b26F421741e481'
const factoryAddress = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' // Uniswap V3 Factory address

async function calculateMinimumOutput(amountIn, sqrtPriceX96, decimals0, decimals1) {
  // Convert sqrtPriceX96 to actual price
  const price = (BigInt(sqrtPriceX96) * BigInt(sqrtPriceX96)) / (2n ** 192n)
  
  // Calculate expected output
  const expectedOutput = (BigInt(amountIn) * price * BigInt(10 ** decimals1)) / BigInt(10 ** decimals0)
  
  // Apply 7% slippage tolerance (93% of expected output)
  const slippageTolerance = 93n // 93%
  const minimumOutput = (expectedOutput * slippageTolerance) / 100n
  
  return minimumOutput
}

async function swapTokens(tokenInSymbol, tokenOutSymbol) {
  // Get token information from the configuration
  const tokenIn = tokens[tokenInSymbol]
  const tokenOut = tokens[tokenOutSymbol]

  if (!tokenIn || !tokenOut) {
    throw new Error(`Token configuration not found for ${tokenInSymbol} or ${tokenOutSymbol}`)
  }

  // Find the pool address
  const { poolAddress, fee, metrics } = await findPool(tokenIn.address, tokenOut.address, provider)
  console.log("\nPool metrics:")
  console.log("Liquidity:", metrics.liquidity, "ETH")
  console.log("Recent swaps:", metrics.swapCount)
  console.log("Last swap block:", metrics.lastSwapTime)

  const poolContract = new ethers.Contract(
    poolAddress,
    IUniswapv3PoolABI,
    provider
  )

  const immutables = await getPoolImmutables(poolContract)
  const state = await getPoolState(poolContract)

  console.log("\nPool details:")
  console.log("Token0: "+immutables.token0)
  console.log("Token1: "+immutables.token1)
  console.log("Fee: "+immutables.fee)
  console.log("Price: "+ state.sqrtPriceX96)

  const wallet = new ethers.Wallet(WALLET_SECRET)
  const connectedWallet = wallet.connect(provider)

  const swapRouterContract = new ethers.Contract(
    swapRouterAddress,
    SwapRouterABI,
    provider
  )

  const inputAmount = 0.001
  const amountIn = ethers.parseUnits(
    inputAmount.toString(),
    tokenIn.decimals
  )

  // Calculate minimum output with 7% slippage
  const minimumOutput = await calculateMinimumOutput(
    amountIn,
    state.sqrtPriceX96,
    tokenIn.decimals,
    tokenOut.decimals
  )

  

  const approvalAmount = (amountIn * BigInt(100000)).toString()
  
  
  
  const tokenContract0 = new ethers.Contract(
    tokenIn.address,
    ERC20ABI,
    provider
  )
  
  
  
  const approvalResponse = await tokenContract0.connect(connectedWallet).approve(
    swapRouterAddress,
    approvalAmount
  )
  console.log(approvalResponse)
 
  const params = {
    tokenIn: immutables.token0,
    tokenOut: immutables.token1,
    fee: immutables.fee,
    recipient: WALLET_ADDRESS,
    amountIn: amountIn,
    amountOutMinimum: minimumOutput,
    sqrtPriceLimitX96: 0
  }

  
  const transaction = swapRouterContract.connect(connectedWallet).exactInputSingle(
    params,
    {
      gasLimit: 10000000
    }
  ).then(transaction => {
    console.log(transaction)
  })
}

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

async function main() {
  try {
    // Get balances for all tokens
    const balances = await getTokenBalance(WALLET_ADDRESS)
    console.log('\nAll token balances:', balances)
    
    // Get price changes for all tokens
    const allPriceChanges = await getAllPriceChanges()
    console.log('\nAll token price changes:', JSON.stringify(allPriceChanges, null, 2))
    
    // Get price changes for a specific token
    const wethChanges = await getPriceChanges('WETH')
    console.log('\nWETH price changes:', JSON.stringify(wethChanges, null, 2))

    // Perform the swap
    //await swapTokens('WETH', 'KEYCAT')
  } catch (error) {
    console.error('Error in main:', error.message)
  }
}

main()