const express = require("express");
const router = express.Router();
const axios = require("axios");
const moment = require("moment");
const qs = require("qs");
const NodeCache = require("node-cache");
const dividendsCache = new NodeCache({ stdTTL: 3600 * 24 }); // cache for 24 hours
const numOfSimulation = 10000; //42375200 : 40 million tickets predictions
const batchSize = 100000; // 1 million per batch

async function getPowerballHistory(
    gameName = "powerball",
    startDate = "01/01/2021",
    endDate = moment().format("DD/MM/YYYY")
) {
    console.log(numOfSimulation.toLocaleString());
    const powerballHistUrl = `https://www.nationallottery.co.za/index.php?task=results.getHistoricalData&Itemid=272&option=com_weaver&controller=${gameName}-history`;
    try {
        const formData = {
            gameName: gameName.toUpperCase().replace(/-/g, ""),
            startDate,
            endDate,
            offset: 0,
            limit: 104, // 12 months
            isAjax: true,
        };

        const response = await axios.post(powerballHistUrl, qs.stringify(formData), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "User-Agent": "Mozilla/5.0",
            },
            timeout: 15000,
        });

        return response.data;
    } catch (error) {
        console.error("Error fetching Powerball history:", error.message);
        return null;
    }
}

async function getPowerballDividents(gameName = "powerball", drawNumber = 1499) {
    const cacheKey = `${gameName}:${drawNumber}`;
    const cached = dividendsCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const powerballHistUrl = `https://www.nationallottery.co.za/index.php?task=results.redirectPageURL&Itemid=273&option=com_weaver&controller=${gameName}-history`;
    try {
        const formData = {
            gameName: gameName.toUpperCase().replace(/-/g, ""),
            drawNumber,
            isAjax: true,
        };

        const response = await axios.post(powerballHistUrl, qs.stringify(formData), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "User-Agent": "Mozilla/5.0",
            },
            timeout: 15000,
        });

        dividendsCache.set(cacheKey, response.data);
        return response.data;
    } catch (error) {
        console.error("Error fetching Powerball dividends:", error.message);
        return null;
    }
}

router.get("/generate", async function (req, res) {
    try {
        const { gameName = "powerball", limit = 200, startDate, endDate } = req.query;

        // 1️⃣ Fetch Powerball History
        const historyData = await getPowerballHistory(gameName, startDate, endDate);
        if (!historyData || !historyData.data) {
            return res.status(500).json({
                status: 0,
                msg: "Failed to fetch Powerball history",
            });
        }

        const draws = historyData.data.slice(0, limit);

        // 2️⃣ Extract main and Powerball numbers
        const allMainBalls = [];
        const allPowerBalls = [];
        draws.forEach(d => {
            allMainBalls.push(...[d.ball1, d.ball2, d.ball3, d.ball4, d.ball5].map(Number));
            allPowerBalls.push(Number(d.powerball));
        });

        // Frequency maps
        const freqMap = {};
        const powerFreqMap = {};
        allMainBalls.forEach(num => freqMap[num] = (freqMap[num] || 0) + 1);
        allPowerBalls.forEach(num => powerFreqMap[num] = (powerFreqMap[num] || 0) + 1);

        // Sort frequencies
        const sortedMain = Object.entries(freqMap).sort((a, b) => b[1] - a[1]);
        const sortedPower = Object.entries(powerFreqMap).sort((a, b) => b[1] - a[1]);

        const hotBalls = sortedMain.slice(0, 10).map(([n]) => parseInt(n));
        const coldBalls = sortedMain.slice(-10).map(([n]) => parseInt(n));
        const hotPower = sortedPower[0] ? parseInt(sortedPower[0][0]) : 1;
        const coldPower = sortedPower.slice(-1)[0] ? parseInt(sortedPower.slice(-1)[0][0]) : 20;

        // 3️⃣ Pair & Triplet Correlations
        const pairCount = {};
        const tripletCount = {};
        draws.forEach(({ ball1, ball2, ball3, ball4, ball5 }) => {
            const nums = [ball1, ball2, ball3, ball4, ball5].map(Number).sort((a, b) => a - b);

            // pairs
            for (let i = 0; i < nums.length; i++) {
                for (let j = i + 1; j < nums.length; j++) {
                    const key = `${nums[i]},${nums[j]}`;
                    pairCount[key] = (pairCount[key] || 0) + 1;
                }
            }

            // triplets
            for (let i = 0; i < nums.length; i++)
                for (let j = i + 1; j < nums.length; j++)
                    for (let k = j + 1; k < nums.length; k++) {
                        const key = `${nums[i]},${nums[j]},${nums[k]}`;
                        tripletCount[key] = (tripletCount[key] || 0) + 1;
                    }
        });

        const topPairs = Object.entries(pairCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([k]) => k.split(",").map(Number));

        const topTriplets = Object.entries(tripletCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([k]) => k.split(",").map(Number));

        // 4️⃣ Monte Carlo weighted hybrid function
        function randomHybridBall(pool, hotSet, coldSet, combo = [], topPairs = [], topTriplets = []) {
            const weights = pool.map(n => {
                let w = 2; // base
                if (hotSet.includes(n)) w += 3;
                if (coldSet.includes(n)) w += 1;

                // reinforce pairs
                combo.forEach(c => {
                    if (topPairs.some(p => p.includes(n) && p.includes(c))) w += 2;
                });

                // reinforce triplets
                topTriplets.forEach(t => {
                    const match = combo.filter(c => t.includes(c));
                    if (match.length >= 2 && t.includes(n)) w += 3;
                });

                return w;
            });

            const total = weights.reduce((a, b) => a + b, 0);
            const rand = Math.random() * total;
            let cumulative = 0;
            for (let i = 0; i < pool.length; i++) {
                cumulative += weights[i];
                if (rand <= cumulative) return pool[i];
            }
            return pool[0];
        }

        const allBalls = [...new Set(allMainBalls)].sort((a, b) => a - b);
        const allPower = [...new Set(allPowerBalls)].sort((a, b) => a - b);

        // 5️⃣ Simulation with frequency aggregation only
        const comboFreq = {};
        const totalBatches = Math.ceil(numOfSimulation / batchSize);

        for (let b = 0; b < totalBatches; b++) {
            for (let i = 0; i < batchSize && (b * batchSize + i) < numOfSimulation; i++) {
                let combo = [];
                while (combo.length < 5) {
                    const n = randomHybridBall(allBalls, hotBalls, coldBalls, combo, topPairs, topTriplets);
                    if (!combo.includes(n)) combo.push(n);
                }
                combo.sort((a, b) => a - b);
                const powerball = randomHybridBall(allPower, [hotPower], [coldPower]);
                const key = combo.join(",") + "|" + powerball;
                comboFreq[key] = (comboFreq[key] || 0) + 1;
            }
            console.log(`Batch ${b + 1}/${totalBatches} completed...`);
        }

        // 6️⃣ Top 5 combos
        const topCombos = Object.entries(comboFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([combo]) => {
                const [mainStr, pStr] = combo.split("|");
                return {
                    balls: mainStr.split(",").map(Number),
                    powerball: parseInt(pStr)
                };
            });

        res.json({
            status: 1,
            msg: `Hybrid ${gameName} numbers generated successfully from ${numOfSimulation.toLocaleString()} simulations between ${startDate} to ${endDate}`,
            results: topCombos,
            analysis: {
                hotBalls,
                coldBalls,
                hotPower,
                coldPower,
                topPairs,
                topTriplets
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            status: 0,
            msg: "Internal server error",
            error: err.message,
        });
    }
});

router.get("/history", async function (req, res) {
    try {
        const { startDate, endDate, gameName } = req.query;
        const data = await getPowerballHistory(
            gameName,
            startDate,
            endDate || moment().format("DD/MM/YYYY")
        );

        if (!data) {
            return res.status(500).json({
                status: 0,
                msg: "Failed to fetch Powerball data",
            });
        }

        res.json({
            status: 1,
            msg: "Fetched Powerball data successfully",
            total: data?.data?.length || 0,
            results: data,
        });
    } catch (err) {
        console.error("err:", err);
        res.status(500).json({
            status: 0,
            msg: "Internal server error",
            error: err.message,
        });
    }
});

router.get("/dividents", async function (req, res) {
    try {
        const { gameName, drawNumber } = req.query;
        const data = await getPowerballDividents(
            gameName, drawNumber
        );

        if (!data) {
            return res.status(500).json({
                status: 0,
                msg: "Failed to fetch Powerball data",
            });
        }

        res.json({
            status: 1,
            msg: "Fetched Powerball data successfully",
            total: data?.data?.length || 0,
            results: data,
        });
    } catch (err) {
        console.error("err:", err);
        res.status(500).json({
            status: 0,
            msg: "Internal server error",
            error: err.message,
        });
    }
});

module.exports = router;
