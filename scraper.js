const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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
            '--disable-blink-features=AutomationControlled'
        ]
    });
    
    let page = null;
    const start = Date.now();

    try {
        page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Go to the live matches page
        await page.goto('https://www.sportybet.com/ng/m/sport/football/live_list?source=home_list', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // Wait for matches to load
        await page.waitForSelector('.m-event-live, .m-live-row', { timeout: 30000 });

        // Function to check if loading is present
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

        // Function to wait for loading to disappear
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
            ).catch(() => {});
        }

        // Function to extract live matches from current page state
        async function getCurrentLiveMatches() {
            return await page.evaluate(() => {
                const matches = [];

                // Valid live statuses - matches that are currently playing
                const LIVE_STATUSES = ['H1', 'H2', 'HT', 'ET', 'PEN', '2H', '1H', 'Half Time', 'Extra Time'];

                // Find all match elements
                const elements = document.querySelectorAll('[data-key^="sr:match:"]');

                elements.forEach(element => {
                    const matchKey = element.getAttribute('data-key');
                    if (!matchKey || !matchKey.startsWith('sr:match:')) return;

                    // Get match status
                    const statusElement = element.querySelector('.match-status');
                    const status = statusElement?.textContent?.trim() || '';

                    // Check if this is actually LIVE
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

                    // Skip if not live
                    if (!isActuallyLive && !hasLiveIndicator) {
                        return;
                    }

                    // Get team names
                    const teamElements = element.querySelectorAll('.m-info-cell .team');
                    const homeTeam = teamElements[0]?.textContent?.trim() || 'Unknown';
                    const awayTeam = teamElements[1]?.textContent?.trim() || 'Unknown';

                    // Get scores
                    const scoreElements = element.querySelectorAll('.score .set-score');
                    const homeScore = scoreElements[0]?.textContent?.trim() || '0';
                    const awayScore = scoreElements[1]?.textContent?.trim() || '0';

                    // Get odds (1X2)
                    const oddsElements = element.querySelectorAll('.market-id-1 .m-outcome-odds .m-odds-value');
                    const odds = {
                        home: oddsElements[0]?.textContent?.trim() || null,
                        draw: oddsElements[1]?.textContent?.trim() || null,
                        away: oddsElements[2]?.textContent?.trim() || null
                    };

                    // Check for STV and SFM
                    const hasSTV = !!element.querySelector('.stv-icon');
                    const hasSFM = !!element.querySelector('.sfm-icon');

                    // Get market size
                    const marketSizeElement = element.querySelector('.m-market-size');
                    const marketSize = marketSizeElement?.textContent?.trim() || '0';

                    // Get labels
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

        // Function to get all matches with scrolling
        async function scrollAndExtractLiveMatches() {
            let allMatches = [];
            let previousCount = 0;
            let noNewMatches = 0;

            // Get initial matches
            allMatches = await getCurrentLiveMatches();
            console.log(`Found ${allMatches.length} live matches so far...`);

            // Keep scrolling until no new matches appear
            while (true) {
                // Check if loading is present and wait
                if (await isLoadingPresent()) {
                    await waitForLoadingToDisappear();
                }

                // Scroll down
                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight * 0.8);
                });

                // Wait a bit for new content to load
                await new Promise(resolve => setTimeout(resolve, 1500));

                // Check for loading after scroll
                if (await isLoadingPresent()) {
                    await waitForLoadingToDisappear();
                }

                // Get current matches
                const currentMatches = await getCurrentLiveMatches();

                // Merge with existing matches (avoid duplicates)
                const seen = new Set();
                const mergedMatches = [];

                // Add existing matches first
                for (let match of allMatches) {
                    if (!seen.has(match.matchKey)) {
                        seen.add(match.matchKey);
                        mergedMatches.push(match);
                    }
                }

                // Add new matches
                for (let match of currentMatches) {
                    if (!seen.has(match.matchKey)) {
                        seen.add(match.matchKey);
                        mergedMatches.push(match);
                    }
                }

                // Check if we got new matches
                if (mergedMatches.length === previousCount) {
                    noNewMatches++;
                } else {
                    noNewMatches = 0;
                }

                previousCount = mergedMatches.length;
                allMatches = mergedMatches;

                console.log(`Found ${allMatches.length} live matches total...`);

                // Check if we've reached the bottom
                const reachedBottom = await page.evaluate(() => {
                    const bottomNav = document.querySelector('.m-bottom-nav, .m-footer');
                    if (!bottomNav) return false;

                    const rect = bottomNav.getBoundingClientRect();
                    return rect.top <= window.innerHeight;
                });

                // Stop if we've reached the bottom or no new matches after 3 attempts
                if (reachedBottom || noNewMatches >= 3) {
                    console.log(reachedBottom ? 'Reached bottom of page' : 'No new matches found');
                    break;
                }
            }

            return allMatches;
        }

        // Get all live matches with scrolling
        const allLiveMatches = await scrollAndExtractLiveMatches();

        // Remove duplicates one final time
        const seen = new Set();
        const uniqueMatches = [];
        for (let match of allLiveMatches) {
            if (!seen.has(match.matchKey)) {
                seen.add(match.matchKey);
                uniqueMatches.push(match);
            }
        }

        console.log(`\n=== FINAL RESULTS ===`);
        console.log(`Total live matches found: ${uniqueMatches.length}`);

        // Display matches in a readable format
        uniqueMatches.forEach((m, index) => {
            console.log(`${index + 1}. ${m.homeTeam} ${m.homeScore} - ${m.awayScore} ${m.awayTeam}`);
            console.log(`   ${m.status} ${m.time} | Odds: ${m.odds.home} | ${m.odds.draw} | ${m.odds.away}`);
            console.log(`   Labels: ${m.labels.join(', ') || 'None'}`);
            console.log('');
        });

        // Save data
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dataDir = path.join(__dirname, 'data');
        fs.mkdirSync(dataDir, { recursive: true });

        const jsonFilename = path.join(dataDir, `live_matches_${timestamp}.json`);
        fs.writeFileSync(jsonFilename, JSON.stringify(uniqueMatches, null, 2));
        console.log(`\nData saved to: ${jsonFilename}`);

        return uniqueMatches;

    } catch (error) {
        if (page) {
            await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        }
        throw error;
    } finally {
        const end = Date.now();
        console.log(`Scraping took ${end - start} ms`);
        await browser.close();
    }
}

// Run the scraper
scrapeLiveMatches()
    .then(matches => {
        console.log(`\nSuccessfully scraped ${matches.length} live matches`);
    })
    .catch(error => {
        console.error('Scraping failed:', error);
        process.exit(1);
    });