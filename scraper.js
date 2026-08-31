const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Nigerian timezone
const NIGERIA_TIMEZONE = 'Africa/Lagos';

// Track sent matches
const SENT_MATCHES_FILE = path.join(__dirname, 'sent_matches.json');
let sentMatchIds = new Set();

// Save sent matches
function saveSentMatches() {
    try {
        const data = JSON.stringify([...sentMatchIds]);
        fs.writeFileSync(SENT_MATCHES_FILE, data);
    } catch (error) {
        console.error(`[${getNigeriaTime()}] Error saving sent matches:`, error.message);
    }
}

// Add match to sent list
function markMatchAsSent(matchId) {
    sentMatchIds.add(matchId);
    saveSentMatches();
}

// Check if match was already sent
function isMatchAlreadySent(matchId) {
    return sentMatchIds.has(matchId);
}

// Telegram Configuration
const BOT_TOKEN = '8804191374:AAFfsRgka7LEno_k-6CWUS8m-8otGt5PItM';
const USER_ID = '-5513202747';

function getNigeriaTime() {
    return new Date().toLocaleString('en-US', { timeZone: NIGERIA_TIMEZONE });
}

function getNigeriaDate() {
    return new Date().toLocaleDateString('en-US', { timeZone: NIGERIA_TIMEZONE });
}

async function sendTelegramMessage(message) {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

        await axios.post(url, {
            chat_id: USER_ID,
            text: message,
            parse_mode: "HTML"
        });

        console.log(`[${getNigeriaTime()}] Telegram notification sent`);

    } catch (error) {
        console.error(`[${getNigeriaTime()}] Telegram error:`, error.response?.data || error.message);
    }
}

// Check if match is simulated (SRL)
function isSimulatedMatch(homeTeam, awayTeam) {
    const srlPattern = /\bSRL\b/i;
    return srlPattern.test(homeTeam) || srlPattern.test(awayTeam);
}

async function scrapeLiveMatches() {
    const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: {
            width: 760,
            height: 800
        },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--memory-pressure-off'
        ]
    });

    let page = null;
    const start = Date.now();

    try {
        page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto('https://www.sportybet.com/ng/m/sport/football/live_list?source=home_list', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForSelector('.m-event-live, .m-live-row', { timeout: 30000 });

        async function isLoadingPresent() {
            return await page.evaluate(() => {
                const loadingSelectors = [
                    '.m-loading-wrap',
                    '.m-page-loading-wrap',
                    '.m-loading',
                    '.loading',
                    '.loading-page-fail'
                ];

                for (const selector of loadingSelectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        const display = window.getComputedStyle(element).display;
                        const rect = element.getBoundingClientRect();
                        if (display !== 'none' && rect.width > 0 && rect.height > 0) {
                            return true;
                        }
                    }
                }
                return false;
            });
        }

        async function waitForLoadingToDisappear() {
            await page.waitForFunction(
                () => {
                    const loadingSelectors = ['.m-loading-wrap', '.m-page-loading-wrap', '.m-loading', '.loading'];
                    for (const selector of loadingSelectors) {
                        const element = document.querySelector(selector);
                        if (element) {
                            const display = window.getComputedStyle(element).display;
                            const rect = element.getBoundingClientRect();
                            if (display !== 'none' && rect.width > 0 && rect.height > 0) {
                                return false;
                            }
                        }
                    }
                    return true;
                },
                { timeout: 3000, polling: 500 }
            ).catch(() => { });
        }

        async function getCurrentLiveMatches() {
            return await page.evaluate(() => {
                const matches = [];

                const LIVE_STATUSES = ['H1', 'H2', 'HT', 'ET', 'PEN', '2H', '1H', 'Half Time', 'Extra Time'];

                const elements = document.querySelectorAll('[data-key^="sr:match:"]');

                elements.forEach(element => {
                    const matchKey = element.getAttribute('data-key');
                    if (!matchKey || !matchKey.startsWith('sr:match:')) return;

                    const statusElement = element.querySelector('.match-status');
                    const status = statusElement?.textContent?.trim() || '';

                    const isActuallyLive = LIVE_STATUSES.some(liveStatus =>
                        status.includes(liveStatus) || status === liveStatus
                    );

                    const hasLiveIndicator = !!(
                        element.querySelector('.m-icon-live') ||
                        element.querySelector('.live-label') ||
                        element.querySelector('.m-mark-live')
                    );

                    const timeElement = element.querySelector('.m-event-time');
                    const time = timeElement?.textContent?.trim() || '';

                    if (!isActuallyLive && !hasLiveIndicator) {
                        return;
                    }

                    const teamElements = element.querySelectorAll('.m-info-cell .team');
                    const homeTeam = teamElements[0]?.textContent?.trim() || 'Unknown';
                    const awayTeam = teamElements[1]?.textContent?.trim() || 'Unknown';

                    const scoreElements = element.querySelectorAll('.score .set-score');
                    const homeScore = scoreElements[0]?.textContent?.trim() || '0';
                    const awayScore = scoreElements[1]?.textContent?.trim() || '0';

                    const oddsElements = element.querySelectorAll('.market-id-1 .m-outcome-odds .m-odds-value');
                    const odds = {
                        home: oddsElements[0]?.textContent?.trim() || null,
                        draw: oddsElements[1]?.textContent?.trim() || null,
                        away: oddsElements[2]?.textContent?.trim() || null
                    };

                    const hasSTV = !!element.querySelector('.stv-icon');
                    const hasSFM = !!element.querySelector('.sfm-icon');

                    const marketSizeElement = element.querySelector('.m-market-size');
                    const marketSize = marketSizeElement?.textContent?.trim() || '0';

                    const labels = [];
                    const labelElements = element.querySelectorAll('.label .label-text');
                    labelElements.forEach(label => {
                        labels.push(label.textContent.trim());
                    });

                    const matchId = matchKey.replace('sr:match:', '');

                    matches.push({
                        matchKey: matchKey,
                        matchId: matchId,
                        homeTeam: homeTeam,
                        awayTeam: awayTeam,
                        time: time,
                        status: status,
                        homeScore: homeScore,
                        awayScore: awayScore,
                        odds: odds,
                        hasLiveIndicator: hasLiveIndicator,
                        hasSTV: hasSTV,
                        hasSFM: hasSFM,
                        labels: labels,
                        marketSize: marketSize
                    });
                });

                return matches;
            });
        }

        async function scrollAndExtractLiveMatches() {
            let allMatches = [];
            let previousCount = 0;
            let noNewMatches = 0;

            allMatches = await getCurrentLiveMatches();
            console.log(`[${getNigeriaTime()}] Found ${allMatches.length} live matches so far...`);

            while (true) {
                if (await isLoadingPresent()) {
                    await waitForLoadingToDisappear();
                }

                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight * 0.8);
                });

                await new Promise(resolve => setTimeout(resolve, 1500));

                if (await isLoadingPresent()) {
                    await waitForLoadingToDisappear();
                }

                const currentMatches = await getCurrentLiveMatches();

                const seen = new Set();
                const mergedMatches = [];

                for (let match of allMatches) {
                    if (!seen.has(match.matchKey)) {
                        seen.add(match.matchKey);
                        mergedMatches.push(match);
                    }
                }

                for (let match of currentMatches) {
                    if (!seen.has(match.matchKey)) {
                        seen.add(match.matchKey);
                        mergedMatches.push(match);
                    }
                }

                if (mergedMatches.length === previousCount) {
                    noNewMatches++;
                } else {
                    noNewMatches = 0;
                }

                previousCount = mergedMatches.length;
                allMatches = mergedMatches;

                console.log(`[${getNigeriaTime()}] Found ${allMatches.length} live matches total...`);

                const reachedBottom = await page.evaluate(() => {
                    const bottomNav = document.querySelector('.m-bottom-nav, .m-footer');
                    if (!bottomNav) return false;

                    const rect = bottomNav.getBoundingClientRect();
                    return rect.top <= window.innerHeight;
                });

                if (reachedBottom || noNewMatches >= 3) {
                    console.log(reachedBottom ? 'Reached bottom of page' : 'No new matches found');
                    break;
                }
            }

            return allMatches;
        }

        const allLiveMatches = await scrollAndExtractLiveMatches();

        const seen = new Set();
        const uniqueMatches = [];
        for (let match of allLiveMatches) {
            if (!seen.has(match.matchKey)) {
                seen.add(match.matchKey);
                uniqueMatches.push(match);
            }
        }

        console.log(`\n[${getNigeriaTime()}] === FINAL RESULTS ===`);
        console.log(`Total live matches found: ${uniqueMatches.length}`);

        const nigeriaDate = getNigeriaDate().replace(/\//g, '-');
        const dataDir = path.join(__dirname, 'data');
        fs.mkdirSync(dataDir, { recursive: true });

        const jsonFilename = path.join(dataDir, `live_matches_${nigeriaDate}.json`);
        fs.writeFileSync(jsonFilename, JSON.stringify(uniqueMatches, null, 2));
        console.log(`\n[${getNigeriaTime()}] Data saved to: ${jsonFilename}`);

        return uniqueMatches;

    } catch (error) {
        if (page) {
            await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        }
        throw error;
    } finally {
        const end = Date.now();
        console.log(`[${getNigeriaTime()}] Scraping took ${end - start} ms`);
        await browser.close();
    }
}

// Main function that runs every 5 minutes
async function runForever() {
    console.log(`[${getNigeriaTime()}] Starting SportyBet Live Match Scraper (Nigeria Time)`);
    console.log(`[${getNigeriaTime()}] Will run every 5 minutes with browser restart to prevent memory leaks\n`);

    let runCount = 0;

    while (true) {
        try {
            runCount++;
            console.log(`\n[${getNigeriaTime()}] Run #${runCount} starting...`);

            const currentMatches = await scrapeLiveMatches();

            // Filter out simulated matches
            const realMatches = currentMatches.filter(match => {
                return !isSimulatedMatch(match.homeTeam, match.awayTeam);
            });

            // Only get matches with empty time and non-empty market size
            const matchesToNotify = realMatches.filter(match => {
                return match.time === '' && match.marketSize !== '0' && match.marketSize !== '';
            });

            // Filter out already sent matches
            const newMatchesToNotify = matchesToNotify.filter(match => !isMatchAlreadySent(match.matchId));

            if (newMatchesToNotify.length > 0) {
                console.log(`[${getNigeriaTime()}] Found ${newMatchesToNotify.length} new matches to notify`);

                for (const match of newMatchesToNotify) {
                    const oddsText = match.odds.home && match.odds.draw && match.odds.away
                        ? `Home: ${match.odds.home} | Draw: ${match.odds.draw} | Away: ${match.odds.away}`
                        : 'No odds available';

                    const message =
                        `<b>Match: ${match.homeTeam} vs ${match.awayTeam}</b>\n` +
                        `Status: ${match.status}\n` +
                        `Market Size: ${match.marketSize}\n` +
                        `Odds: ${oddsText}\n` +
                        `Match ID: ${match.matchId}\n` +
                        `Time: ${getNigeriaTime()}`;

                    await sendTelegramMessage(message);

                    // Mark as sent after successful send
                    markMatchAsSent(match.matchId);

                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            } else {
                console.log(`[${getNigeriaTime()}] No new matches to notify`);
            }

            console.log(`[${getNigeriaTime()}] Run #${runCount} completed successfully!`);
            console.log(`[${getNigeriaTime()}] Total matches: ${currentMatches.length}`);

        } catch (error) {
            console.error(`[${getNigeriaTime()}] Error in run #${runCount}:`, error.message);
        }

        // Wait 5 minutes before next run
        console.log(`[${getNigeriaTime()}] Waiting 5 minutes until next run...`);
        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 minutes
    }
}

// Start the forever loop
runForever().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});