const { ethers } = require('ethers')
const { abi: IUniswapv3PoolABI } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json')
const { abi: SwapRouterABI } = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json')
const { abi: FactoryABI } = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json')
const { getPoolImmutables, getPoolState } = require('./helpers')
const { findPool } = require('./poolUtils')
const { getTokenBalance, getSingleTokenBalance } = require('./walletUtils')
const { getPriceChanges, getAllPriceChanges } = require('./priceMonitor')
const tokens = require('./tokens.json')
const ERC20ABI = require('./abi.json')

require('dotenv').config()
const INFURA_URL_MAINNET = process.env.INFURA_URL_MAINNET
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const WALLET_SECRET = process.env.WALLET_SECRET

const provider = new ethers.JsonRpcProvider(INFURA_URL_MAINNET)
const swapRouterAddress = '0x2626664c2603336E57B271c5C0b26F421741e481'
const factoryAddress = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' // Uniswap V3 Factory address

// Add delay function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// Add rate limiting wrapper
async function withRateLimit(fn, ...args) {
  await delay(1000) // Wait 1 second between calls
  return fn(...args)
}

async function calculateMinimumOutput(amountIn, poolContract, decimalsIn, decimalsOut, isToken0Input) {
  try {
    // Get the current price from the pool's slot0
    const slot0 = await poolContract.slot0()
    const currentPrice = Number(slot0.sqrtPriceX96) / (2 ** 96)
    const price = currentPrice * currentPrice

    console.log(`Pool price calculation:`)
    console.log(`Current sqrt price: ${currentPrice}`)
    console.log(`Current price: ${price}`)

    // Calculate expected output
    let expectedOutput
    if (isToken0Input) {
      // If token0 is input, multiply by price
      expectedOutput = amountIn * price
    } else {
      // If token1 is input, divide by price
      expectedOutput = amountIn / price
    }

    console.log(`Amount in: ${amountIn}`)
    console.log(`Expected output: ${expectedOutput}`)

    // Apply 7% slippage tolerance (93% of expected output)
    const slippageTolerance = 0.93 // 93%
    const minimumOutput = expectedOutput * slippageTolerance

    console.log(`Minimum output after 7% slippage: ${minimumOutput}`)

    // Convert to regular decimal string with fixed precision
    const minimumOutputString = minimumOutput.toFixed(decimalsOut)
    console.log(`Minimum output as string: ${minimumOutputString}`)

    // Convert to wei
    return ethers.parseUnits(minimumOutputString, decimalsOut)
  } catch (error) {
    console.error('Error in calculateMinimumOutput:', error)
    console.log('Falling back to zero minimum output')
    return 0n
  }
}

async function swapTokens(tokenInSymbol, tokenOutSymbol, amount) {
  // Get token information from the configuration
  const tokenIn = tokens[tokenInSymbol]
  const tokenOut = tokens[tokenOutSymbol]

  if (!tokenIn || !tokenOut) {
    throw new Error(`Token configuration not found for ${tokenInSymbol} or ${tokenOutSymbol}`)
  }

  // Find the pool address with rate limiting
  const { poolAddress, fee, metrics } = await withRateLimit(findPool, tokenIn.address, tokenOut.address, provider)
  console.log("\nPool metrics:")
  console.log("Liquidity:", metrics.liquidity, "ETH")
  console.log("Recent swaps:", metrics.swapCount)
  console.log("Last swap block:", metrics.lastSwapTime)

  const poolContract = new ethers.Contract(
    poolAddress,
    IUniswapv3PoolABI,
    provider
  )

  const immutables = await withRateLimit(getPoolImmutables, poolContract)
  const state = await withRateLimit(getPoolState, poolContract)

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

  console.log(`Amount: ${amount}`)
  // Convert wei amount to regular number for price calculation
  const inputAmount = Number(ethers.formatUnits(amount, tokenIn.decimals))

  // Determine the correct token ordering for the swap
  const isToken0Input = immutables.token0.toLowerCase() === tokenIn.address.toLowerCase()

  // Calculate minimum output with 7% slippage using inputAmount instead of amountIn
  const minimumOutput = await calculateMinimumOutput(
    inputAmount,
    poolContract,
    tokenIn.decimals,
    tokenOut.decimals,
    isToken0Input
  )

  const tokenContract0 = new ethers.Contract(
    tokenIn.address,
    ERC20ABI,
    provider
  )
  
  const approvalResponse = await tokenContract0.connect(connectedWallet).approve(
    swapRouterAddress,
    amount // amount is already in wei
  )
  console.log(approvalResponse)
 
  const params = {
    tokenIn: isToken0Input ? immutables.token0 : immutables.token1,
    tokenOut: isToken0Input ? immutables.token1 : immutables.token0,
    fee: immutables.fee,
    recipient: WALLET_ADDRESS,
    amountIn: amount, // amount is already in wei
    amountOutMinimum: minimumOutput,
    sqrtPriceLimitX96: 0
  }

  console.log(`Swapping ${tokenInSymbol} to ${tokenOutSymbol}`)
  console.log(`TokenIn address: ${params.tokenIn}`)
  console.log(`TokenOut address: ${params.tokenOut}`)
  console.log(`Amount in: ${ethers.formatUnits(amount, tokenIn.decimals)} ${tokenInSymbol}`)
  console.log(`Minimum output: ${ethers.formatUnits(minimumOutput, tokenOut.decimals)} ${tokenOutSymbol}`)

  return swapRouterContract.connect(connectedWallet).exactInputSingle(
    params,
    {
      gasLimit: 10000000
    }
  )
}

async function executeTradingStrategy(walletAddress) {
  try {
    // Get WETH price changes with rate limiting
    const wethPriceChanges = await withRateLimit(getPriceChanges, 'WETH')
    const weth1hChange = wethPriceChanges.priceChanges.find(change => change.timeframe === '1h')
    const weth6hChange = wethPriceChanges.priceChanges.find(change => change.timeframe === '6h')

    // Get all token balances with rate limiting
    const allBalances = await withRateLimit(getTokenBalance, walletAddress)
    const wethBalance = allBalances.find(balance => balance.symbol === 'WETH')
    const otherTokenBalances = allBalances.filter(balance => balance.symbol !== 'WETH')

    // Check WETH price conditions
    const isWethPositive = (weth1hChange.isPositive && weth1hChange.percentage > 1) || 
                          (weth6hChange.isPositive && weth6hChange.percentage > 1)

    console.log(`WETH is positive: ${isWethPositive}`)
    console.log(`WETH 1h change: ${weth1hChange.percentage}`)
    console.log(`WETH 6h change: ${weth6hChange.percentage}`)

    let bestToken = null
    let highestChange = -Infinity

    if (isWethPositive) {
      // Get price changes for all tokens with rate limiting
      const allPriceChanges = await withRateLimit(getAllPriceChanges)
      
      // Filter out WETH and find token with highest positive change
      const otherTokensPriceChanges = allPriceChanges.filter(token => token.symbol !== 'WETH')
      
      for (const token of otherTokensPriceChanges) {
        const oneHourChange = token.priceChanges.find(change => change.timeframe === '1h')
        const sixHourChange = token.priceChanges.find(change => change.timeframe === '6h')

        if (oneHourChange.isPositive && oneHourChange.percentage > highestChange) {
          highestChange = oneHourChange.percentage
          bestToken = token
        }
        if (sixHourChange.isPositive && sixHourChange.percentage > highestChange) {
          highestChange = sixHourChange.percentage
          bestToken = token
        }
      }

      console.log(`Best token: ${bestToken.symbol} with ${highestChange}% change`)
      // If WETH is positive, only swap tokens that are not the best token
      if (bestToken) {
        const tokensToSwapToWeth = otherTokenBalances.filter(balance => 
          parseFloat(balance.formattedBalance) > 1 && balance.symbol !== bestToken.symbol
        )

        // First, swap all non-best tokens to WETH and wait for each transaction
        console.log('\nSwapping non-best tokens to WETH...')
        for (const token of tokensToSwapToWeth) {
          console.log(`Swapping ${token.symbol} to WETH (not the best token)...`)
          const swapTx = await swapTokens(token.symbol, 'WETH', token.rawBalance)
          console.log(`Waiting for ${token.symbol} to WETH swap to be confirmed...`)
          await swapTx.wait() // Wait for transaction to be confirmed
          console.log(`${token.symbol} to WETH swap confirmed!`)
        }

        // After all WETH swaps are confirmed, swap WETH to best token
        console.log(`\nAll WETH swaps completed. Now swapping WETH to ${bestToken.symbol}...`)
        const finalSwapTx = await swapTokens('WETH', bestToken.symbol, wethBalance.rawBalance)
        console.log('Waiting for final swap to be confirmed...')
        await finalSwapTx.wait()
        console.log(`Successfully swapped WETH to ${bestToken.symbol}!`)
      } else {
        console.log('\nNo tokens with positive price change found. Keeping WETH.')
      }
    } else {
      // If WETH is not positive, swap all tokens with balance > 1 to WETH
      const tokensToSwapToWeth = otherTokenBalances.filter(balance => 
        parseFloat(balance.formattedBalance) > 1
      )

      console.log('\nSwapping all tokens to WETH...')
      for (const token of tokensToSwapToWeth) {
        console.log(`Swapping ${token.symbol} to WETH (WETH not positive)...`)
        const swapTx = await swapTokens(token.symbol, 'WETH', token.rawBalance)
        console.log(`Waiting for ${token.symbol} to WETH swap to be confirmed...`)
        await swapTx.wait() // Wait for transaction to be confirmed
        console.log(`${token.symbol} to WETH swap confirmed!`)
      }
      console.log('\nWETH price changes not significant. Keeping WETH.')
    }

  } catch (error) {
    console.error('Error in trading strategy:', error.message)
    throw error
  }
}

module.exports = {
  executeTradingStrategy,
  swapTokens
} 