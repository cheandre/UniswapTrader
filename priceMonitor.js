const puppeteer = require('puppeteer');
const tokens = require('./tokens.json');

async function getPriceChanges(tokenSymbol) {
  const token = tokens[tokenSymbol];
  
  if (!token || !token.priceUrl) {
    throw new Error(`Token configuration or price URL not found for ${tokenSymbol}`);
  }

  let browser;
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Navigate to the page and wait for network to be idle
    await page.goto(token.priceUrl, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    // Wait for the price change elements to be present
    await page.waitForSelector('.interval-information__intervals', { timeout: 10000 });

    // Get all price changes
    const priceChanges = await page.evaluate(() => {
      const timeframes = ['5m', '1h', '6h', '24h', '7d'];
      const changes = [];
      
      // Get the container with the intervals
      const intervalsContainer = document.querySelector('.interval-information__intervals');
      if (!intervalsContainer) {
        throw new Error('Could not find intervals container');
      }

      // Get all spans with price changes within the container
      const spans = intervalsContainer.querySelectorAll('div span.buy-color, div span.sell-color');
      
      spans.forEach((span, index) => {
        if (index < 5) { // We only want the first 5 changes
          const percentage = span.textContent.trim();
          const isPositive = span.classList.contains('buy-color');
          
          if (percentage && percentage.includes('%')) {
            changes.push({
              timeframe: timeframes[index],
              percentage: parseFloat(percentage),
              isPositive
            });
          }
        }
      });
      
      return changes;
    });

    // Ensure we got all 5 timeframes
    if (priceChanges.length !== 5) {
      throw new Error(`Expected 5 price changes, got ${priceChanges.length}. Found elements: ${JSON.stringify(priceChanges)}`);
    }

    return {
      symbol: tokenSymbol,
      name: token.name,
      priceChanges
    };
  } catch (error) {
    console.error(`Error fetching price changes for ${tokenSymbol}:`, error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function getAllPriceChanges() {
  const results = [];
  let browser;
  
  try {
    // Launch browser once for all requests
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    for (const symbol of Object.keys(tokens)) {
      try {
        const priceData = await getPriceChanges(symbol);
        results.push(priceData);
        // Add a small delay between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed to get price changes for ${symbol}:`, error.message);
      }
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  return results;
}



module.exports = {
  getPriceChanges,
  getAllPriceChanges
}; 