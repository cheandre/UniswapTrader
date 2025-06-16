const fs = require('fs');
const path = require('path');

// Get the project root directory
const PROJECT_ROOT = process.cwd();
const TRADES_FILE = path.join(PROJECT_ROOT, 'trades.json');

function loadTrades() {
    try {
        if (fs.existsSync(TRADES_FILE)) {
            const data = fs.readFileSync(TRADES_FILE, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('Error loading trades:', error);
        return [];
    }
}

function saveTrade(trade) {
    try {
        const trades = loadTrades();
        trades.push({
            ...trade,
            timestamp: new Date().toISOString()
        });
        fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
        console.log(`Trade saved to ${TRADES_FILE}`);
    } catch (error) {
        console.error('Error saving trade:', error);
    }
}

module.exports = {
    saveTrade
}; 