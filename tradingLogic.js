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

async function executeTradingStrategy(walletAddress) {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      // Get WETH price changes with rate limiting
      const wethPriceChanges = await withRateLimit(getPriceChanges, 'WETH')
      if (!wethPriceChanges || !wethPriceChanges.priceChanges) {
        throw new Error('Failed to get WETH price changes')
      }
      const weth1hChange = wethPriceChanges.priceChanges.find(change => change.timeframe === '1h')
      const weth6hChange = wethPriceChanges.priceChanges.find(change => change.timeframe === '6h')
      if (!weth1hChange || !weth6hChange) {
        throw new Error('Missing WETH price change data')
      }

      // Get all token balances with rate limiting
      const allBalances = await withRateLimit(getTokenBalance, walletAddress)
      const wethBalance = allBalances.find(balance => balance.symbol === 'WETH')
      const otherTokenBalances = allBalances.filter(balance => balance.symbol !== 'WETH')

      // Get price changes for all tokens with rate limiting
      const allPriceChanges = await withRateLimit(getAllPriceChanges)
      if (!allPriceChanges || !Array.isArray(allPriceChanges)) {
        throw new Error('Failed to get all price changes')
      }

      // Validate price changes for all tokens
      for (const token of otherTokenBalances) {
        const tokenPriceData = allPriceChanges.find(t => t.symbol === token.symbol)
        if (!tokenPriceData || !tokenPriceData.priceChanges) {
          throw new Error(`Failed to get price changes for ${token.symbol}`)
        }
        const oneHourChange = tokenPriceData.priceChanges.find(change => change.timeframe === '1h')
        const sixHourChange = tokenPriceData.priceChanges.find(change => change.timeframe === '6h')
        if (!oneHourChange || !sixHourChange) {
          throw new Error(`Missing price change data for ${token.symbol}`)
        }
      }

      // Check WETH price conditions
      const isWethPositive = (weth1hChange.isPositive && weth1hChange.percentage > 1) || 
                            (weth6hChange.isPositive && weth6hChange.percentage > 1)

      console.log(`WETH is positive: ${isWethPositive}`)
      console.log(`WETH 1h change: ${weth1hChange.percentage}`)
      console.log(`WETH 6h change: ${weth6hChange.percentage}`)

      let bestToken = null
      let highestChange = -Infinity

      if (isWethPositive) {
        // Filter out WETH and find token with highest positive change
        const otherTokensPriceChanges = allPriceChanges.filter(token => token.symbol !== 'WETH')
        
        for (const token of otherTokensPriceChanges) {
          const oneHourChange = token.priceChanges.find(change => change.timeframe === '1h')
          const sixHourChange = token.priceChanges.find(change => change.timeframe === '6h')
          //if >30 skip
          if (oneHourChange.percentage < 30 && sixHourChange.percentage < 30 && oneHourChange.isPositive && sixHourChange.isPositive)
          { 
            if (oneHourChange.isPositive && oneHourChange.percentage > highestChange) {
              highestChange = oneHourChange.percentage
              bestToken = token
            }
            if (sixHourChange.isPositive && sixHourChange.percentage > highestChange) {
              highestChange = sixHourChange.percentage
              bestToken = token
            }
          }
        }

        console.log(`Best token: ${bestToken.symbol} with ${highestChange}% change`)
        
        // If WETH is positive, only swap tokens that meet specific criteria
        if (bestToken) {
          const tokensToSwapToWeth = otherTokenBalances.filter(balance => {
            if (parseFloat(balance.formattedBalance) <= 1) return false;
            if (balance.symbol === bestToken.symbol) return false;
            
            const tokenPriceData = allPriceChanges.find(t => t.symbol === balance.symbol);
            if (!tokenPriceData) return false;
            
            const oneHourChange = tokenPriceData.priceChanges.find(change => change.timeframe === '1h');
            const sixHourChange = tokenPriceData.priceChanges.find(change => change.timeframe === '6h');
            
            // Check if token is down on 1h or 6h
            const isDownOn1h = !oneHourChange.isPositive;
            const isDownOn6h = !sixHourChange.isPositive;
            
            // Check if token has at least 2% growing difference compared to best token
            const bestToken1h = bestToken.priceChanges.find(change => change.timeframe === '1h');
            const bestToken6h = bestToken.priceChanges.find(change => change.timeframe === '6h');
            
            const growingDifference1h = bestToken1h.percentage - oneHourChange.percentage;
            const growingDifference6h = bestToken6h.percentage - sixHourChange.percentage;
            
            const has2PercentDifference = growingDifference1h >= 4 || growingDifference6h >= 4;
            
            // Swap if token is down on 1h or 6h, OR has at least 4% growing difference
            return isDownOn1h || isDownOn6h || has2PercentDifference;
          });

          console.log(`\nTokens to swap to WETH (down on 1h/6h or 4%+ difference from best):`);
          tokensToSwapToWeth.forEach(token => {
            const tokenPriceData = allPriceChanges.find(t => t.symbol === token.symbol);
            const oneHourChange = tokenPriceData.priceChanges.find(change => change.timeframe === '1h');
            const sixHourChange = tokenPriceData.priceChanges.find(change => change.timeframe === '6h');
            const bestToken1h = bestToken.priceChanges.find(change => change.timeframe === '1h');
            const bestToken6h = bestToken.priceChanges.find(change => change.timeframe === '6h');
            
            const growingDifference1h = bestToken1h.percentage - oneHourChange.percentage;
            const growingDifference6h = bestToken6h.percentage - sixHourChange.percentage;
            
            console.log(`${token.symbol}: 1h(${oneHourChange.percentage}%), 6h(${sixHourChange.percentage}%), diff from best: 1h(${growingDifference1h.toFixed(2)}%), 6h(${growingDifference6h.toFixed(2)}%)`);
          });

          // First, swap qualifying tokens to WETH and wait for each transaction
          console.log('\nSwapping qualifying tokens to WETH...')
          for (const token of tokensToSwapToWeth) {
            const tokenPriceChanges = allPriceChanges.find(t => t.symbol === token.symbol)
            const priceChanges = {
              wethPriceChanges: {
                '1h': weth1hChange,
                '6h': weth6hChange
              },
              tokenPriceChanges: {
                '1h': tokenPriceChanges.priceChanges.find(change => change.timeframe === '1h'),
                '6h': tokenPriceChanges.priceChanges.find(change => change.timeframe === '6h')
              }
            }
            console.log(`Swapping ${token.symbol} to WETH (meets swap criteria)...`)
            const swapTx = await swapTokens(token.symbol, 'WETH', token.rawBalance, priceChanges)
            console.log(`Waiting for ${token.symbol} to WETH swap to be confirmed...`)
            await swapTx.wait() // Wait for transaction to be confirmed
            console.log(`${token.symbol} to WETH swap confirmed!`)
          }

          // Get updated WETH balance after all swaps
          console.log('\nGetting updated WETH balance...')
          const updatedBalances = await withRateLimit(getTokenBalance, walletAddress)
          const updatedWethBalance = updatedBalances.find(balance => balance.symbol === 'WETH')
          console.log(`Updated WETH balance: ${updatedWethBalance.formattedBalance}`)
          if (updatedWethBalance.formattedBalance > 0.0001) {
            // After all WETH swaps are confirmed, swap WETH to best token
            const bestTokenPriceChanges = allPriceChanges.find(t => t.symbol === bestToken.symbol)
            const priceChanges = {
              wethPriceChanges: {
                '1h': weth1hChange,
                '6h': weth6hChange
              },
              tokenPriceChanges: {
                '1h': bestTokenPriceChanges.priceChanges.find(change => change.timeframe === '1h'),
                '6h': bestTokenPriceChanges.priceChanges.find(change => change.timeframe === '6h')
              }
            }
            console.log(`\nAll WETH swaps completed. Now swapping WETH to ${bestToken.symbol}...`)
            const finalSwapTx = await swapTokens('WETH', bestToken.symbol, updatedWethBalance.rawBalance, priceChanges)
            console.log('Waiting for final swap to be confirmed...')
            await finalSwapTx.wait()
            console.log(`Successfully swapped WETH to ${bestToken.symbol}!`)
          } else {
            console.log('\nNo WETH balance found.. Already on token')
          }
        } else {
          console.log('\nNo tokens with positive price change found. Keeping WETH.')
        }
      } else {
        // If WETH is not positive, check if it's down more than 0.85% in both timeframes
        const isWethDownSignificantly = 
          !weth1hChange.isPositive && weth1hChange.percentage < -0.85 &&
          !weth6hChange.isPositive && weth6hChange.percentage < -0.85;

        // Find tokens that are down more than 3% in 1h
        const tokensDownSignificantly = otherTokenBalances.filter(balance => {
          if (balance.symbol === 'WETH') return false;
          const tokenPriceChanges = allPriceChanges.find(t => t.symbol === balance.symbol);
          if (!tokenPriceChanges) return false;
          const oneHourChange = tokenPriceChanges.priceChanges.find(change => change.timeframe === '1h');
          return oneHourChange && !oneHourChange.isPositive && oneHourChange.percentage < -3;
        });

        // Combine both conditions: WETH down significantly or tokens down more than 3%
        if (isWethDownSignificantly || tokensDownSignificantly.length > 0) {
          let tokensToSwapToWeth = [];

          if (isWethDownSignificantly) {
            // Add all tokens with balance > 1
            tokensToSwapToWeth = otherTokenBalances.filter(balance => 
              parseFloat(balance.formattedBalance) > 1
            );
            console.log('\nWETH is down significantly (>0.75%) in both timeframes. Swapping all tokens to WETH...');
          }

          // Add tokens that are down more than 3% in 1h
          tokensDownSignificantly.forEach(token => {
            if (parseFloat(token.formattedBalance) > 0.0001) {
              tokensToSwapToWeth.push(token);
            }
          });

          if (tokensDownSignificantly.length > 0) {
            console.log('\nFound tokens down more than 3% in 1h timeframe:');
            tokensDownSignificantly.forEach(token => {
              const tokenPriceChanges = allPriceChanges.find(t => t.symbol === token.symbol);
              const oneHourChange = tokenPriceChanges.priceChanges.find(change => change.timeframe === '1h');
              console.log(`${token.symbol}: ${oneHourChange.percentage}%`);
            });
          }

          // Remove duplicates and WETH
          tokensToSwapToWeth = tokensToSwapToWeth.filter((token, index, self) =>
            token.symbol !== 'WETH' && 
            index === self.findIndex(t => t.symbol === token.symbol)
          );

          for (const token of tokensToSwapToWeth) {
            const tokenPriceChanges = allPriceChanges.find(t => t.symbol === token.symbol)
            const priceChanges = {
              wethPriceChanges: {
                '1h': weth1hChange,
                '6h': weth6hChange
              },
              tokenPriceChanges: {
                '1h': tokenPriceChanges.priceChanges.find(change => change.timeframe === '1h'),
                '6h': tokenPriceChanges.priceChanges.find(change => change.timeframe === '6h')
              }
            }
            console.log(`Swapping ${token.symbol} to WETH (${isWethDownSignificantly ? 'WETH down >0.75%' : 'Token down >3%'})...`)
            const swapTx = await swapTokens(token.symbol, 'WETH', token.rawBalance, priceChanges)
            console.log(`Waiting for ${token.symbol} to WETH swap to be confirmed...`)
            await swapTx.wait() // Wait for transaction to be confirmed
            console.log(`${token.symbol} to WETH swap confirmed!`)
          }
        } else {
          console.log('\nNo significant price changes detected. Keeping current positions.')
          console.log(`WETH 1h change: ${weth1hChange.percentage}%`)
          console.log(`WETH 6h change: ${weth6hChange.percentage}%`)
        }
      }

      // If we get here, everything worked, so break the retry loop
      break;

    } catch (error) {
      retryCount++;
      console.error(`Error in trading strategy (attempt ${retryCount}/${maxRetries}):`, error.message)
      
      if (retryCount < maxRetries) {
        console.log('Retrying in 15 seconds...')
        await new Promise(resolve => setTimeout(resolve, 15000)) // Wait 15 seconds
      } else {
        console.error('Max retries reached. Giving up until next 15 minutes')
      }
    }
  }
}

module.exports = {
  executeTradingStrategy,
  swapTokens
} 