const { ethers } = require('ethers')
const { abi: IUniswapv3PoolABI } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json')
const { abi: SwapRouterABI } = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json')
const { abi: FactoryABI } = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json')
const { getPoolImmutables, getPoolState } = require('./helpers')
const { findPool } = require('./poolUtils')
const { getTokenBalance, getSingleTokenBalance } = require('./walletUtils')
const { getPriceChanges, getAllPriceChanges, getChainIds } = require('./priceMonitor')
const { saveTrade } = require('./tradeLogger')
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

async function swapTokens(tokenInSymbol, tokenOutSymbol, amount, priceChanges = null) {
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

  // Log trade information before executing
  const tradeInfo = {
    tokenIn: tokenInSymbol,
    tokenOut: tokenOutSymbol,
    amountIn: ethers.formatUnits(amount, tokenIn.decimals),
    amountOutMinimum: ethers.formatUnits(minimumOutput, tokenOut.decimals),
    poolAddress,
    fee,
    price: {
      sqrtPriceX96: state.sqrtPriceX96.toString(),
      actualPrice: isToken0Input ? 
        (Number(state.sqrtPriceX96) / (2 ** 96)) ** 2 : 
        (2 ** 96 / Number(state.sqrtPriceX96)) ** 2,
      token0IsInput: isToken0Input
    },
    context: priceChanges || {
      wethPriceChanges: {
        '1h': { percentage: 0, isPositive: false },
        '6h': { percentage: 0, isPositive: false }
      },
      tokenPriceChanges: {
        '1h': { percentage: 0, isPositive: false },
        '6h': { percentage: 0, isPositive: false }
      }
    }
  }

  // Execute the swap
  const swapTx = await swapRouterContract.connect(connectedWallet).exactInputSingle(
    params,
    {
      gasLimit: 10000000
    }
  )
  const receipt = await swapTx.wait();

  // Extract actual output amount from Swap event
  let actualAmountOut = null;
  for (const log of receipt.logs) {
    try {
      const parsed = poolContract.interface.parseLog(log);
      if (parsed.name === 'Swap') {
        // For exactInputSingle:
        // - WETH -> TOKEN: amount0 < 0 (WETH spent), amount1 > 0 (TOKEN received)
        // - TOKEN -> WETH: amount0 > 0 (WETH received), amount1 < 0 (TOKEN spent)
        actualAmountOut = {
          amount0: parsed.args.amount0.toString(),
          amount1: parsed.args.amount1.toString()
        };
        break;
      }
    } catch (e) {
      // Not a Swap event, skip
    }
  }
  tradeInfo.actualAmountOut = actualAmountOut;

  // Save trade information
  saveTrade(tradeInfo)

  return swapTx;
}


async function executeTradingStrategy2(walletAddress) {
  let swapped = false;
  try {
    // 1. Get balances and price changes
    const allBalances = await withRateLimit(getTokenBalance, walletAddress);
    const wethBalance = allBalances.find(balance => balance.symbol === 'WETH');
    const otherTokenBalances = allBalances.filter(balance => balance.symbol !== 'WETH');

    const wethPriceChanges = await withRateLimit(getPriceChanges, 'WETH');
    const allPriceChanges = await withRateLimit(getAllPriceChanges);

    const weth1hChange = wethPriceChanges.priceChanges.find(c => c.timeframe === '1h');
    const weth6hChange = wethPriceChanges.priceChanges.find(c => c.timeframe === '6h');

    const wethAmount = wethBalance ? parseFloat(wethBalance.formattedBalance) : 0;
    console.log(`\nExecuting Strategy 2...`);
    console.log(`Current WETH balance: ${wethAmount}`);

    // 2. Check if we have WETH to invest
    if (wethAmount > 0.001) {
      console.log('Checking entry conditions...');
      // 2.1 Check ETH intervals
      if (weth1hChange.percentage > 1 && weth6hChange.percentage > 2) {
        console.log(`WETH is up >1% in 1h and >2% in 6h. Looking for a token to buy.`);

        let bestToken = null;
        let highestVariation = -Infinity;

        // 2.1.1 Find best token
        for (const token of otherTokenBalances) {
          const tokenPriceData = allPriceChanges.find(p => p.symbol === token.symbol);
          if (!tokenPriceData) continue;
          
          const token1hChange = tokenPriceData.priceChanges.find(c => c.timeframe === '1h');
          
          if (token1hChange && token1hChange.isPositive && 
              token1hChange.percentage >= (2 * weth1hChange.percentage) && 
              token1hChange.percentage < 15) {
            
            if (token1hChange.percentage > highestVariation) {
              highestVariation = token1hChange.percentage;
              bestToken = token;
            }
          }
        }

        // 2.1.2 Swap if a token is found
        if (bestToken) {
          console.log(`Found best token: ${bestToken.symbol} with 1h change of ${highestVariation}%. Swapping WETH to ${bestToken.symbol}.`);
          const swapTx = await swapTokens('WETH', bestToken.symbol, wethBalance.rawBalance);
          await swapTx.wait();
          swapped = true;
          console.log(`Successfully swapped WETH to ${bestToken.symbol}!`);
        } else {
          console.log('No token met the entry criteria. Holding WETH.');
        }
      } else {
        console.log('WETH price movement does not meet entry criteria. Holding WETH.');
      }
    } else { // 3. WETH balance is low, check for exit
      console.log('Checking exit conditions...');
      // 3.1 Get token with significant balance
      const currentTokenHolding = otherTokenBalances.find(b => parseFloat(b.formattedBalance) > 0.01);

      if (currentTokenHolding) {
        console.log(`Currently holding ${currentTokenHolding.symbol}`);
        const tokenPriceData = allPriceChanges.find(p => p.symbol === currentTokenHolding.symbol);
        const token1hChange = tokenPriceData.priceChanges.find(c => c.timeframe === '1h');

        // 3.2 Check exit conditions
        const exitCondition1 = !weth1hChange.isPositive && weth1hChange.percentage < -0.5;
        const exitCondition2 = token1hChange && !token1hChange.isPositive && token1hChange.percentage < -3;

        if (exitCondition1 || exitCondition2) {
          console.log(`Exit condition met. WETH 1h: ${weth1hChange.percentage}%, Token 1h: ${token1hChange ? token1hChange.percentage : 'N/A'}%`);
          console.log(`Swapping ${currentTokenHolding.symbol} back to WETH.`);
          // 3.2.1 Swap token for WETH
          const swapTx = await swapTokens(currentTokenHolding.symbol, 'WETH', currentTokenHolding.rawBalance);
          await swapTx.wait();
          swapped = true;
          console.log(`Successfully swapped ${currentTokenHolding.symbol} to WETH!`);
        } else {
          console.log('Exit conditions not met. Holding token.');
        }
      } else {
        console.log('No significant token holding found and WETH balance is low. Nothing to do.');
      }
    }

  } catch (error) {
    console.error('Error in executeTradingStrategy2:', error.message);
    // Not re-throwing the error to prevent retries from the main loop if it's a strategy logic issue
  }
  return swapped;
}

module.exports = {
  executeTradingStrategy2,
  swapTokens
} 