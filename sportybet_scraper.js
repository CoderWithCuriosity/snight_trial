const { exec } = require('child_process');
const path = require('path');

// Nigerian timezone
const NIGERIA_TIMEZONE = 'Africa/Lagos';

/**
 * Gets the current time in Nigeria
 */
function getNigeriaTime() {
    return new Date().toLocaleString('en-US', {
        timeZone: NIGERIA_TIMEZONE
    });
}

/**
 * Calculates milliseconds until next 11:50 PM (23:50) Nigerian time
 */
function getMillisecondsUntilNextRun() {
    const now = new Date();
    const nigeriaTime = new Date(now.toLocaleString('en-US', {
        timeZone: NIGERIA_TIMEZONE
    }));
    
    // Set target time to 23:50 (11:50 PM) today
    const target = new Date(nigeriaTime);
    target.setHours(23, 50, 0, 0);
    
    // If target time has already passed today, schedule for tomorrow
    if (nigeriaTime >= target) {
        target.setDate(target.getDate() + 1);
    }
    
    const millisecondsUntil = target.getTime() - nigeriaTime.getTime();
    return millisecondsUntil;
}

/**
 * Runs the scraper script
 */
function runScraper() {
    console.log(`[${new Date().toISOString()}] Starting SportyBet scraper...`);
    console.log(`Nigerian time: ${new Date().toLocaleString('en-US', { timeZone: NIGERIA_TIMEZONE })}`);
    
    const scriptPath = path.join(__dirname, 'getMatches.js');
    
    const child = exec(`node "${scriptPath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`[${new Date().toISOString()}] Scraper error:`, error);
            console.error('stderr:', stderr);
            return;
        }
        console.log(`[${new Date().toISOString()}] Scraper completed successfully`);
        console.log(stdout);
        if (stderr) {
            console.error('stderr:', stderr);
        }
    });
    
    // Log output in real-time
    child.stdout.on('data', (data) => {
        console.log(`[Scraper] ${data.trim()}`);
    });
    
    child.stderr.on('data', (data) => {
        console.error(`[Scraper Error] ${data.trim()}`);
    });
}

/**
 * Main scheduler loop - runs indefinitely
 */
function scheduleNextRun() {
    const millisecondsUntil = getMillisecondsUntilNextRun();
    
    const hours = Math.floor(millisecondsUntil / (1000 * 60 * 60));
    const minutes = Math.floor((millisecondsUntil % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((millisecondsUntil % (1000 * 60)) / 1000);
    
    const nextRunTime = new Date(Date.now() + millisecondsUntil);
    const nextRunNigeria = nextRunTime.toLocaleString('en-US', {
        timeZone: NIGERIA_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    console.log(`[${new Date().toISOString()}] Next run scheduled in ${hours}h ${minutes}m ${seconds}s`);
    console.log(`[${new Date().toISOString()}] Next run at (Nigerian time): ${nextRunNigeria}`);
    
    setTimeout(() => {
        console.log(`[${new Date().toISOString()}] ⏰ Scheduled time reached!`);
        runScraper();
        
        // After running, schedule the next one
        scheduleNextRun();
    }, millisecondsUntil);
}

/**
 * Starts the scheduler
 */
function startScheduler() {
    console.log('=== SportyBet Daily Scraper Scheduler ===');
    console.log(`Timezone: ${NIGERIA_TIMEZONE}`);
    console.log(`Current Nigerian time: ${new Date().toLocaleString('en-US', { timeZone: NIGERIA_TIMEZONE })}`);
    console.log('Schedule: Every day at 11:50 PM Nigerian time');
    console.log('===========================================\n');
    
    // Run immediately on first start (optional - remove if you want to wait)
    runScraper();
    
    // Start the scheduling loop
    scheduleNextRun();
}

// Handle process termination gracefully
process.on('SIGINT', () => {
    console.log(`\n[${new Date().toISOString()}] Received SIGINT. Shutting down scheduler...`);
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log(`\n[${new Date().toISOString()}] Received SIGTERM. Shutting down scheduler...`);
    process.exit(0);
});

// Start the scheduler
startScheduler();