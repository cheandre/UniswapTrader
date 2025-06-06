const { ethers } = require('ethers')
const { abi: IUniswapv3PoolABI } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json')
const { abi: SwapRouterABI } = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json')
const { getPoolImmutables, getPoolState } = require('./helpers')
const ERC20ABI = require('./abi.json')


require('dotenv').config()
const INFURA_URL_MAINNET = process.env.INFURA_URL_MAINNET
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const WALLET_SECRET = process.env.WALLET_SECRET

console.log(INFURA_URL_MAINNET + "infura")

const provider =  new ethers.JsonRpcProvider(INFURA_URL_MAINNET); // Ropsten
const poolAddress = "0xd82403772cB858219cfb58bFab46Ba7a31073474" //"0x4D7C363DED4B3b4e1F954494d2Bc3955e49699cC" 0x287b0e934ed0439e2a7b1d5f0fc25ea2c24b64f7// UNI/WETH
const swapRouterAddress = '0x2626664c2603336E57B271c5C0b26F421741e481'


const name0 = 'Wrapped Ether'
const symbol0 = 'WETH'
const decimals0 = 18
const address0 = '0x4200000000000000000000000000000000000006'

const name1 = 'KEYCAT Token'
const symbol1 = 'KEYCAT'
const decimals1 = 18
const address1 = '0x9a26F5433671751C3276a065f57e5a02D2817973' //'0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'



async function calculateMinimumOutput(amountIn, sqrtPriceX96, decimals0, decimals1) {
  // Convert sqrtPriceX96 to actual price
  const price = (sqrtPriceX96 * sqrtPriceX96) / (2n ** 192n)
  
  // Calculate expected output
  const expectedOutput = (amountIn * price * BigInt(10 ** decimals1)) / BigInt(10 ** decimals0)
  
  // Apply 7% slippage tolerance (93% of expected output)
  const slippageTolerance = 93n // 93%
  const minimumOutput = (expectedOutput * slippageTolerance) / 100n
  
  return minimumOutput
}

async function main() {
  const poolContract = new ethers.Contract(
    poolAddress,
    IUniswapv3PoolABI,
    provider
  )

  const immutables = await getPoolImmutables(poolContract)
  const state = await getPoolState(poolContract)

  console.log("Token0: "+immutables.token0 )
  console.log("Token1: "+immutables.token1 )
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
  //const inputAmount = 800
  // .001 => 1 000 000 000 000 000
  const amountIn = ethers.parseUnits(
    inputAmount.toString(),
    decimals0
  )

  // Calculate minimum output with 7% slippage
  const minimumOutput = await calculateMinimumOutput(
    amountIn,
    state.sqrtPriceX96,
    decimals0,
    decimals1
  )

  console.log(amountIn)

  const approvalAmount = (amountIn * BigInt(100000)).toString()
  
  console.log(approvalAmount)
  
  const tokenContract0 = new ethers.Contract(
    address0,
    ERC20ABI,
    provider
  )
  
  console.log('  TESTE  ')
  
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
    //deadline: Math.floor(Date.now() / 1000) + (60 * 100),
    amountIn: amountIn,
    amountOutMinimum: minimumOutput,
    sqrtPriceLimitX96: 0
  }

  console.log('  TESTE1  ')
  const transaction = swapRouterContract.connect(connectedWallet).exactInputSingle(
    params,
    {
     // value: amountIn,
      gasLimit: 10000000
      //gasLimit: 10000000,
      //gasLimit: ethers.BigNumber.from(500_000), // Safer, realistic estimate
      //maxFeePerGas: 25000000000, // or higher depending on network
      //maxPriorityFeePerGas: 2000000000
    }
  ).then(transaction => {
    console.log(transaction)
  }) 
}

main()