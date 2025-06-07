exports.getPoolImmutables = async (poolContract) => {
    const [token0, token1, fee] = await Promise.all([
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee()
    ])
  
    const immutables = {
      token0: token0,
      token1: token1,
      fee: fee
    }
    return immutables
  }
  
  exports.getPoolState = async (poolContract) => {
    const slot = await Promise.all([ poolContract.slot0() ])
  
    const state = {
      sqrtPriceX96: slot[0].sqrtPriceX96
    }
    console.log("slot0"+ slot[0])
    return state
  }