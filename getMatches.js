const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function scrapeSportyBetMatches() {
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

        const day = new Date().getDay();
        //today
        //tomorrow
        await page.goto(`https://www.sportybet.com/ng/m/sport/football?time=${day + 1}&source=sport_menu&sort=0`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForSelector('.m-table.m-sports-table.football, .m-event-sport', { timeout: 30000 });

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

        async function getCurrentMatches() {
            return await page.evaluate(() => {
                const matches = [];
                const elements = document.querySelectorAll('[data-key^="sr:match:"]');

               const toSlug = (text) => {
                    return text
                        .replace(/[\/\s]+/g, '_')  // replace spaces and slashes with _
                        .trim();
                };

                const formatLeague = (text) => {
                    const parts = text.split(' - ');
                    const clean = (str) =>
                        str.trim().replace(/\s+/g, '_');
                    if (parts.length === 2) {
                        return `${clean(parts[0].trim())}/${clean(parts[1].trim())}`;
                    }
                    return text.trim();
                };

                const extractLeague = (text) => {
                    const parts = text.split(' - ');
                    if (parts.length === 2) {
                        return [parts[0].trim(), parts[1].trim()];
                    }
                    return ['Unknown', text.trim()];
                };

                elements.forEach(element => {
                    const matchKey = element.getAttribute('data-key');
                    const matchRow = element.querySelector('.m-event-sport');
                    if (!matchRow) return;

                    const teamElements = matchRow.querySelectorAll('.m-info-cell .team');
                    const homeTeam = teamElements[0]?.textContent?.trim() || 'Unknown';
                    const awayTeam = teamElements[1]?.textContent?.trim() || 'Unknown';

                    const leagueElement = matchRow.querySelector('.m-league-name');
                    const league = leagueElement?.textContent?.trim() || 'Unknown';

                    const timeElement = matchRow.querySelector('.m-time');
                    const time = timeElement?.textContent?.trim() || 'Unknown';

                    const idElement = matchRow.querySelector('.m-game-id');
                    const matchId = idElement?.textContent?.trim() || '';

                    const oddsElements = matchRow.querySelectorAll('.market-id-1 .m-outcome-odds .m-odds-value');
                    const odds = {
                        home: oddsElements[0]?.textContent?.trim() || null,
                        draw: oddsElements[1]?.textContent?.trim() || null,
                        away: oddsElements[2]?.textContent?.trim() || null
                    };

                    const hotLabel = matchRow.querySelector('.label[style*="background-color: rgb(248, 0, 0)"]');
                    const isHot = !!hotLabel;

                    const marketSizeElement = matchRow.querySelector('.m-market-size');
                    const marketSize = marketSizeElement?.textContent?.trim() || '0';

                    const isLive = !!matchRow.querySelector('.m-icon-live, .live-label');

                    const homeslug = toSlug(homeTeam);
                    const awayslug = toSlug(awayTeam);
                    const leagueClean = formatLeague(league);
                    const [country, leagueName] = extractLeague(league);

                    //remove simulated matches
                    if(country == "Simulated Reality League") return;

                    const link = `https://www.sportybet.com/ng/m/sport/football/${leagueClean}/${homeslug}_vs_${awayslug}/${matchKey}`;
                    const result = `https://www.sportybet.com/ng/m/sport/football/live/${leagueClean}/${homeslug}_vs_${awayslug}/${matchKey}`;

                    matches.push({
                        matchKey: matchKey,
                        matchId: matchId,
                        homeTeam: homeTeam,
                        awayTeam: awayTeam,
                        league: league,
                        country,
                        leagueName,
                        time: time,
                        odds: odds,
                        isHot: isHot,
                        isLive: isLive,
                        marketSize: marketSize,
                        link,
                        result
                    });
                });

                return matches;
            });
        }

        async function scrollAndExtractMatches() {
            let allMatches = [];

            // Get initial matches
            allMatches = await getCurrentMatches();

            // Keep scrolling until the bottom nav is detected
            let reachedBottom = false;

            while (!reachedBottom) {
                // Check if loading is present and wait
                if (await isLoadingPresent()) {
                    await waitForLoadingToDisappear();
                }

                // Scroll down
                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight * 0.8);
                });

                // Check for loading after scroll
                if (await isLoadingPresent()) {
                    await waitForLoadingToDisappear();
                }

                // Get current matches
                const currentMatches = await getCurrentMatches();

                allMatches.push(...currentMatches);

                // Check if we've reached the bottom nav using Intersection Observer
                reachedBottom = await page.evaluate(() => {
                    return new Promise((resolve) => {
                        const sentinel = document.querySelector('.m-bottom-nav');
                        if (!sentinel) {
                            resolve(false);
                            return;
                        }

                        const observer = new IntersectionObserver((entries) => {
                            entries.forEach(entry => {
                                if (entry.isIntersecting) {
                                    observer.disconnect();
                                    resolve(true);
                                }
                            });
                        });

                        observer.observe(sentinel);

                        // If the element is already visible, the observer might not trigger
                        // So check immediately as well
                        const rect = sentinel.getBoundingClientRect();
                        if (rect.top <= window.innerHeight) {
                            observer.disconnect();
                            resolve(true);
                        }

                        // Timeout fallback
                        setTimeout(() => {
                            observer.disconnect();
                            resolve(false);
                        }, 3000);
                    });
                });
            }

            return allMatches;
        }

        /**
         * Extracts match details from a SportyBet match page
         */
        async function extractMatchDetailsFromUrl(url) {
            
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });
        
            // Wait for the Stats tab to be visible
            await page.waitForSelector('li.m-nav-item.p-relative.grow-1 span.m-text', { 
                timeout: 15000 
            });
        
            // Find and click the Stats tab
            const statsClicked = await page.evaluate(() => {
                const items = document.querySelectorAll('li.m-nav-item.p-relative.grow-1');
                for (let item of items) {
                    const textSpan = item.querySelector('span.m-text');
                    if (textSpan && textSpan.textContent.trim() === 'Stats') {
                        item.click();
                        return true;
                    }
                }
                return false;
            });
        
            if (!statsClicked) {
                return null;
            }
        
            // Wait for the Sportradar widget to fully load
            await page.waitForSelector('.srm-fullyloaded', { 
                timeout: 30000 
            });
        
        
            // Wait for specific H2H data to be present
            await page.waitForFunction(
                () => {
                    const wins = document.querySelector('.sr-lastmeetingsresults__win-count');
                    return wins && wins.textContent.trim().length > 0;
                },
                { timeout: 20000 }
            );
        
            // Extract all match details
            const matchDetails = await page.evaluate(() => {
                const data = {};
        
                const getText = (selector, parent = document) => {
                    const el = parent.querySelector(selector);
                    return el ? el.textContent.trim() : null;
                };
        
                const getAttr = (selector, attr, parent = document) => {
                    const el = parent.querySelector(selector);
                    return el ? el.getAttribute(attr) : null;
                };
        
                // 1. Match Overview
                const leagueEl = document.querySelector('.m-event-league');
                data.league = leagueEl ? leagueEl.textContent.trim() : null;
        
                const dateEl = document.querySelector('.date');
                if (dateEl) {
                    const dateParts = dateEl.querySelectorAll('div');
                    data.date = {
                        full: dateParts.length >= 2 ? `${dateParts[0].textContent.trim()} ${dateParts[1].textContent.trim()}` : null,
                        day: dateParts.length >= 1 ? dateParts[0].textContent.trim() : null,
                        weekday: dateParts.length >= 2 ? dateParts[1].textContent.trim() : null
                    };
                } else {
                    data.date = { full: null, day: null, weekday: null };
                }
                
                data.time = getText('.time');
                data.gameId = getText('.event-gameid');
        
                // 2. Teams
                const teams = document.querySelectorAll('.team');
                data.teams = {
                    home: { name: null, icon: null },
                    away: { name: null, icon: null }
                };
        
                if (teams.length >= 2) {
                    const homeTeam = teams[0];
                    const homeIcon = homeTeam.querySelector('.team-icon img');
                    const homeName = homeTeam.querySelector('.team-name');
                    data.teams.home.name = homeName ? homeName.textContent.trim() : null;
                    
                    if (homeIcon) {
                        const src = homeIcon.getAttribute('src');
                        data.teams.home.icon = src && src.startsWith('https://') ? src : (src ? 'https:' + src : null);
                    } else {
                        data.teams.home.icon = null;
                    }

                    const awayTeam = teams[1];
                    const awayIcon = awayTeam.querySelector('.team-icon img');
                    const awayName = awayTeam.querySelector('.team-name');
                    data.teams.away.name = awayName ? awayName.textContent.trim() : null;
                    
                    if (awayIcon) {
                        const src = awayIcon.getAttribute('src');
                        data.teams.away.icon = src && src.startsWith('https://') ? src : (src ? 'https:' + src : null);
                    } else {
                        data.teams.away.icon = null;
                    }
                }
        
                // Also get team names from H2H header
                const headerTeams = document.querySelectorAll('.sr-matchteamheader__team');
                if (headerTeams.length >= 2) {
                    data.teams.home.h2hName = headerTeams[0] ? headerTeams[0].textContent.trim() : null;
                    data.teams.away.h2hName = headerTeams[1] ? headerTeams[1].textContent.trim() : null;
                }
        
                // 3. Labels
                const labels = document.querySelectorAll('.label .label-text');
                data.labels = [];
                labels.forEach(label => {
                    data.labels.push(label.textContent.trim());
                });
        
                // 4. H2H Statistics
                const h2hData = {
                    previousMeetings: { homeWins: null, awayWins: null, draws: null },
                    highestWins: { home: null, away: null },
                    averages: {},
                    lastMatches: [],
                    teamForm: {
                        home: { matches: [], leaguePosition: null, form: null },
                        away: { matches: [], leaguePosition: null, form: null }
                    },
                    seasonStats: {
                        scored: { home: null, away: null },
                        conceded: { home: null, away: null }
                    }
                };
        
                // Previous meetings summary
                const winsWrapper = document.querySelector('.sr-lastmeetingsresults__wins-wrapper');
                if (winsWrapper) {
                    const homeWins = winsWrapper.querySelector('.sr-lastmeetingsresults__team-holder-home .sr-lastmeetingsresults__win-count');
                    const awayWins = winsWrapper.querySelector('.sr-lastmeetingsresults__team-holder-away .sr-lastmeetingsresults__win-count');
                    const draws = winsWrapper.querySelector('.sr-largevalsmalltext__component-value');
                    
                    h2hData.previousMeetings.homeWins = homeWins ? homeWins.textContent.trim() : null;
                    h2hData.previousMeetings.awayWins = awayWins ? awayWins.textContent.trim() : null;
                    h2hData.previousMeetings.draws = draws ? draws.textContent.trim() : null;
                }
        
                // Highest wins
                const highestWins = document.querySelectorAll('.sr-lastmeetingsresults__highest-win');
                if (highestWins.length >= 2) {
                    const homeWin = highestWins[0];
                    const homeScore = homeWin.querySelector('.sr-lastmeetingsresults__highest-win-score');
                    const homeDate = homeWin.querySelector('.sr-lastmeetingsresults__highest-win-date');
                    h2hData.highestWins.home = {
                        score: homeScore ? homeScore.textContent.trim() : null,
                        date: homeDate ? homeDate.textContent.trim() : null
                    };
        
                    const awayWin = highestWins[1];
                    const awayScore = awayWin.querySelector('.sr-lastmeetingsresults__highest-win-score');
                    const awayDate = awayWin.querySelector('.sr-lastmeetingsresults__highest-win-date');
                    h2hData.highestWins.away = {
                        score: awayScore ? awayScore.textContent.trim() : null,
                        date: awayDate ? awayDate.textContent.trim() : null
                    };
                }
        
                // Averages
                const averages = document.querySelectorAll('.sr-dualslidechart');
                averages.forEach((avg) => {
                    const title = avg.querySelector('.sr-dualslidechart__title');
                    const labels = avg.querySelectorAll('.sr-dualslidechart__label');
                    
                    if (title && labels.length >= 2) {
                        const key = title.textContent.trim().toLowerCase().replace(' ', '_');
                        h2hData.averages[key] = {
                            home: labels[0] ? labels[0].textContent.trim() : null,
                            away: labels[1] ? labels[1].textContent.trim() : null
                        };
                    }
                });
        
                // Last 5 matches (H2H) - Use title attribute for team names
                const meetings = document.querySelectorAll('.sr-meeting__wrapper');
                meetings.forEach(meeting => {
                    const matchData = {};
        
                    const title = meeting.querySelector('.sr-meeting__title');
                    if (title) {
                        const titleParts = title.textContent.trim().split('|');
                        if (titleParts.length >= 2) {
                            matchData.date = titleParts[0].trim();
                            const leagueParts = titleParts[1].trim().split(',');
                            if (leagueParts.length >= 2) {
                                matchData.league = leagueParts[0].trim();
                                matchData.round = leagueParts[1].trim();
                            }
                        }
                    }
        
                    const teams = meeting.querySelectorAll('.sr-meeting__team');
                    if (teams.length >= 2) {
                        const homeTeam = teams[0];
                        const awayTeam = teams[1];
                        
                        matchData.home = {
                            name: homeTeam.querySelector('.sr-meeting__teamName-name')?.textContent.trim() || null,
                            shortName: homeTeam.querySelector('.sr-meeting__teamName-small')?.textContent.trim() || null,
                            fullName: homeTeam.querySelector('.sr-meeting__teamName-medium')?.textContent.trim() || null,
                            result: homeTeam.querySelector('.sr-meeting__result')?.textContent.trim() || null,
                            isWinner: homeTeam.classList.contains('srm-is-winner')
                        };
        
                        matchData.away = {
                            name: awayTeam.querySelector('.sr-meeting__teamName-name')?.textContent.trim() || null,
                            shortName: awayTeam.querySelector('.sr-meeting__teamName-small')?.textContent.trim() || null,
                            fullName: awayTeam.querySelector('.sr-meeting__teamName-medium')?.textContent.trim() || null,
                            result: awayTeam.querySelector('.sr-meeting__result')?.textContent.trim() || null,
                            isWinner: awayTeam.classList.contains('srm-is-winner')
                        };
                    }
        
                    h2hData.lastMatches.push(matchData);
                });
        
                // Team Form - Home (Use title attribute for opponent names)
                const homeMatches = document.querySelectorAll('.sr-teamform__lastXTeam.srm-left .sr-last-matches__match');
                homeMatches.forEach(match => {
                    const wdl = match.querySelector('.sr-last-matches__wdl');
                    const team = match.querySelector('.sr-last-matches__team');
                    const score = match.querySelector('.sr-last-matches__score');
                    
                    h2hData.teamForm.home.matches.push({
                        result: wdl ? wdl.textContent.trim().charAt(0) : null,
                        opponent: team ? team.getAttribute('title') || team.textContent.trim() : null,
                        score: score ? score.textContent.trim() : null
                    });
                });
        
                // Home league position
                const homePosition = document.querySelector('.sr-leaguepositionform__position-chart:not(.sr-leaguepositionform__position-chart-away)');
                if (homePosition) {
                    const positionEl = homePosition.querySelector('.sr-positionchart__box-content');
                    h2hData.teamForm.home.leaguePosition = positionEl ? positionEl.textContent.trim() : null;
                }
                
                // Home form percentage
                const homeFormPercentage = document.querySelector('.sr-leaguepositionform__circular-chart-home .sr-procvaltext__component-value');
                if (homeFormPercentage) {
                    h2hData.teamForm.home.form = homeFormPercentage.textContent.trim();
                }
        
                // Team Form - Away (Use title attribute for opponent names)
                const awayMatches = document.querySelectorAll('.sr-teamform__lastXTeam.srm-right .sr-last-matches__match');
                awayMatches.forEach(match => {
                    const wdl = match.querySelector('.sr-last-matches__wdl');
                    const team = match.querySelector('.sr-last-matches__team');
                    const score = match.querySelector('.sr-last-matches__score');
                    
                    h2hData.teamForm.away.matches.push({
                        result: wdl ? wdl.textContent.trim().charAt(0) : null,
                        opponent: team ? team.getAttribute('title') || team.textContent.trim() : null,
                        score: score ? score.textContent.trim() : null
                    });
                });
        
                // Away league position
                const awayPosition = document.querySelector('.sr-leaguepositionform__position-chart-away');
                if (awayPosition) {
                    const positionEl = awayPosition.querySelector('.sr-positionchart__box-content');
                    h2hData.teamForm.away.leaguePosition = positionEl ? positionEl.textContent.trim() : null;
                }
                
                // Away form percentage
                const awayFormPercentage = document.querySelector('.sr-leaguepositionform__circular-chart-away .sr-procvaltext__component-value');
                if (awayFormPercentage) {
                    h2hData.teamForm.away.form = awayFormPercentage.textContent.trim();
                }
        
                // Season Stats - Scored
                const scoredHome = document.querySelector('.sr-stackedcomparisonchart__column.srt-fill-home-1');
                const scoredAway = document.querySelector('.sr-stackedcomparisonchart__column.srt-fill-away-1');
                if (scoredHome && scoredAway) {
                    const homeLabel = scoredHome.closest('.sr-stackedcomparisonchart__chart-wrapper')?.querySelector('.sr-stackedcomparisonchart__label-bar.srt-fill-home-1');
                    const awayLabel = scoredHome.closest('.sr-stackedcomparisonchart__chart-wrapper')?.querySelector('.sr-stackedcomparisonchart__label-bar.srt-fill-away-1');
                    
                    h2hData.seasonStats.scored.home = homeLabel ? homeLabel.textContent.trim() : null;
                    h2hData.seasonStats.scored.away = awayLabel ? awayLabel.textContent.trim() : null;
                }
        
                // Season Stats - Conceded (from bottom chart)
                const concededLabels = document.querySelectorAll('.sr-stackedcomparisonchart__svg-chart-bottom .sr-stackedcomparisonchart__label-bar');
                if (concededLabels.length >= 2) {
                    h2hData.seasonStats.conceded.home = concededLabels[0] ? concededLabels[0].textContent.trim() : null;
                    h2hData.seasonStats.conceded.away = concededLabels[1] ? concededLabels[1].textContent.trim() : null;
                }
        
                return {
                    ...data,
                    h2h: h2hData
                };
            });
        
            return matchDetails;
        }

        /**
 * Uploads match data to remote PHP server
 */
async function uploadToRemoteServer(matchesData) {
    const REMOTE_URL = 'https://market-place.name.ng/upload_matches.php'; // Change this to your PHP endpoint
    
    try {
        const response = await fetch(REMOTE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                matches: matchesData,
                timestamp: new Date().toISOString(),
                source: 'sportybet_scraper'
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log(' Upload to remote server successful:', result.message || 'Success');
        return true;
    } catch (error) {
        console.error(' Failed to upload to remote server:', error.message);
        return false;
    }
}

        
        /**
         * Extracts match details from multiple URLs
         */
        async function extractMultipleMatchDetails(data, outputFile='all_match_details.json') {
            try {
                for (let i = 0; i < data.length; i++) {
                    const url = data[i].link;
                    
                    try {
                        const matchData = await extractMatchDetailsFromUrl(url);
                        if (matchData) {
                            data[i]['stat'] =  matchData;
                        }
                    } catch (error) {
                        data[i]['stat'] =  {};
                    }

                    
                    // Save progress after each match
                    fs.writeFileSync(path.join(__dirname, outputFile), JSON.stringify(data, null, 2));
                }
                await uploadToRemoteServer(data);
        
                console.log(`\nAll matches processed. Data saved to ${path.join(__dirname, outputFile)}`);
                
                // Summary
                const successful = data.filter(r => r.stat !== null).length;
                const failed = data.filter(r => r.stat === null).length;
                console.log(`Summary: ${successful} successful, ${failed} failed out of ${data.length} total`);
        
                return data;
        
            } catch (error) {
                console.error('Fatal error:', error.message);
                throw error;
            }
        }

        const extractedMatches = await scrollAndExtractMatches();
        const seen = new Set();
        const matches = [];
        for (let match of extractedMatches) {
            if (!seen.has(match.matchKey)) {
                seen.add(match.matchKey);
                matches.push(match);
            }
        }

        console.log('Extracted Matches Length:', extractedMatches.length);
        console.log('Matches Length:', matches.length);

        // Save data
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const dataDir = path.join(__dirname, 'data');
        await fs.mkdirSync(dataDir, { recursive: true });

        const jsonFilename = path.join(dataDir, `sportybet_matches_${timestamp}.json`);
        await fs.writeFileSync(jsonFilename, JSON.stringify(matches, null, 4));

        if (matches.length > 0) {
            const csvHeader = 'MatchKey,MatchId,HomeTeam,AwayTeam,League,Time,OddsHome,OddsDraw,OddsAway,IsHot,IsLive,MarketSize\n';
            const csvRows = matches.map(m =>
                `${m.matchKey},${m.matchId},"${m.homeTeam.replace(/"/g, '""')}","${m.awayTeam.replace(/"/g, '""')}","${m.league.replace(/"/g, '""')}",${m.time},${m.odds.home || ''},${m.odds.draw || ''},${m.odds.away || ''},${m.isHot ? 'Yes' : 'No'},${m.isLive ? 'Yes' : 'No'},${m.marketSize}`
            );

            const csvFilename = path.join(dataDir, `sportybet_matches_${timestamp}.csv`);
            await fs.writeFileSync(csvFilename, csvHeader + csvRows.join('\n'));
            
            // Now start opening them one by one until all is done
            await extractMultipleMatchDetails(matches);
        }


        return matches;

    } catch (error) {
        if (page) {
            await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        }
        throw error;
    } finally {
        const end = Date.now();

        const duration = end - start;

        console.log(`Took ${duration} ms`);
        await browser.close();
    }
}

scrapeSportyBetMatches()
    .then(matches => {
        console.log(`Successfully scraped ${matches.length} matches`);
    })
    .catch(error => {
        console.error('Scraping failed:', error);
        process.exit(1);
    });