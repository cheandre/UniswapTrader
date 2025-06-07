const { ethers } = require('ethers')
const { abi: IUniswapv3PoolABI } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json')
const { abi: FactoryABI } = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json')
const { getPoolImmutables, getPoolState } = require('./helpers')

const factoryAddress = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' // Uniswap V3 Factory address

async function getPoolMetrics(poolContract) {
  try {
    // Get current pool state
    const state = await getPoolState(poolContract)
    
    // Get liquidity
    const liquidity = await poolContract.liquidity()
    
    // Get recent events to check activity
    const filter = poolContract.filters.Swap()
    const events = await poolContract.queryFilter(filter, -10000) // Last 10000 blocks
    
    // Calculate metrics
    const liquidityInEth = Number(liquidity) / 1e18 // Convert to ETH for readability
    const swapCount = events.length
    const lastSwapTime = events.length > 0 ? events[events.length - 1].blockNumber : 0
    
    return {
      liquidity: liquidityInEth,
      swapCount,
      lastSwapTime,
      sqrtPriceX96: state.sqrtPriceX96,
      tick: state.tick
    }
  } catch (error) {
    console.error('Error getting pool metrics:', error)
    throw error
  }
}

async function findPool(token0, token1, provider) {
  try {
    const factory = new ethers.Contract(factoryAddress, FactoryABI, provider)
    
    // Fee tiers in order of preference (0.01%, 0.05%, 0.3%, 1%)
    const feeTiers = [100, 500, 3000, 10000]
    
    let bestPool = null
    let bestLiquidity = 0n
    
    for (const fee of feeTiers) {
      try {
        console.log(`Checking fee tier ${fee/10000}%...`)
        const poolAddress = await factory.getPool(token0, token1, fee)
        console.log(`Pool address for fee ${fee/10000}%:`, poolAddress)
        
        if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
          // Verify the pool exists by checking its code
          const code = await provider.getCode(poolAddress)
          if (code !== '0x') {
            const poolContract = new ethers.Contract(poolAddress, IUniswapv3PoolABI, provider)
            const metrics = await getPoolMetrics(poolContract)
            
            console.log(`Pool metrics for fee ${fee/10000}%:`)
            console.log(`- Liquidity: ${metrics.liquidity} ETH`)
            console.log(`- Recent swaps: ${metrics.swapCount}`)
            console.log(`- Last swap block: ${metrics.lastSwapTime}`)
            
            // Update best pool if this one has more liquidity
            if (metrics.liquidity > bestLiquidity) {
              bestPool = { poolAddress, fee, metrics }
              bestLiquidity = metrics.liquidity
            }
          }
        }
      } catch (error) {
        console.log(`Error checking fee tier ${fee/10000}%:`, error.message)
        // Continue to next fee tier
      }
    }
    
    if (bestPool) {
      console.log(`\nSelected pool with fee tier ${bestPool.fee/10000}%:`)
      console.log(`- Address: ${bestPool.poolAddress}`)
      console.log(`- Liquidity: ${bestPool.metrics.liquidity} ETH`)
      console.log(`- Recent swaps: ${bestPool.metrics.swapCount}`)
      return bestPool
    }
    
    throw new Error('No valid pool found for the token pair')
  } catch (error) {
    console.error('Error in findPool:', error)
    throw error
  }
}

module.exports = {
  findPool,
  getPoolMetrics
} 