const express = require("express");
const router = express.Router();
const axios = require("axios");
const moment = require("moment");
const qs = require("qs");

async function getPowerballHistory(
    gameName = "powerball",
    startDate = "01/01/2021",
    endDate = moment().format("DD/MM/YYYY")
) {
    const powerballHistUrl = `https://www.nationallottery.co.za/index.php?task=results.getHistoricalData&Itemid=272&option=com_weaver&controller=${gameName}-history`;
    try {
        const formData = {
            gameName: gameName.toUpperCase().replace(/-/g, ""),
            startDate,
            endDate,
            offset: 0,
            limit: 104,
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

async function getPowerballDividents(
    gameName = "powerball",
    drawNumber = 1499
) {
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

        return response.data;
    } catch (error) {
        console.error("Error fetching Powerball dividends:", error.message);
        return null;
    }
}

// Helper to shuffle an array
function shuffleArray(arr) {
    return arr.sort(() => Math.random() - 0.5);
}

router.get("/generate", async function (req, res) {
    try {
        //  gameName = "powerball-plus" | "powerball"
        //  limit = 104 last 12 months

        const { gameName = "powerball", limit = 10 } = req.query;

        // Step 1: Fetch draw history
        const historyData = await getPowerballHistory(gameName);
        if (!historyData || !historyData.data) {
            return res.status(500).json({
                status: 0,
                msg: "Failed to fetch Powerball history",
            });
        }

        const recentDraws = historyData.data.slice(0, limit);
        const ballFreq = {};
        const powerballFreq = {};
        const jackpotZeroDraws = [];

        for (const draw of recentDraws) {
            [draw.ball1, draw.ball2, draw.ball3, draw.ball4, draw.ball5].forEach(b => {
                ballFreq[b] = (ballFreq[b] || 0) + 1;
            });

            powerballFreq[draw.powerball] = (powerballFreq[draw.powerball] || 0) + 1;

            const divData = await getPowerballDividents(gameName, draw.drawNumber);
            if (divData?.data?.drawDetails?.div1Winners === "0") {
                jackpotZeroDraws.push(draw);
            }
        }

        const sortByFreq = (freqObj, desc = true) =>
            Object.entries(freqObj)
                .sort((a, b) => (desc ? b[1] - a[1] : a[1] - b[1]))
                .map(([ball]) => parseInt(ball));

        const sortedMost = sortByFreq(ballFreq, true);
        const sortedLeast = sortByFreq(ballFreq, false);
        const sortedPowerMost = sortByFreq(powerballFreq, true);
        const sortedPowerLeast = sortByFreq(powerballFreq, false);

        // Pick random powerballs from top and bottom sets
        const randomFrom = (arr, count = 1) => shuffleArray(arr).slice(0, count)[0];

        const frequentBalls = shuffleArray(sortedMost.slice(0, 10)).slice(0, 5);
        const infrequentBalls = shuffleArray(sortedLeast.slice(0, 10)).slice(0, 5);

        const frequentPowerball = randomFrom(sortedPowerMost.slice(0, 3));
        const infrequentPowerball = randomFrom(sortedPowerLeast.slice(0, 3));

        // Mixed: 2 frequent + 3 infrequent + most frequent powerball
        const mixedBalls = [
            ...shuffleArray(frequentBalls).slice(0, 2),
            ...shuffleArray(infrequentBalls).slice(0, 3)
        ];
        const mixedPowerball = sortedPowerMost[0];

        // Unique jackpot: random draw where div1Winners = 0
        let uniqueJackpot = null;
        if (jackpotZeroDraws.length > 0) {
            const randomDraw = jackpotZeroDraws[Math.floor(Math.random() * jackpotZeroDraws.length)];
            uniqueJackpot = {
                balls: [randomDraw.ball1, randomDraw.ball2, randomDraw.ball3, randomDraw.ball4, randomDraw.ball5],
                powerball: randomDraw.powerball,
                drawNumber: randomDraw.drawNumber,
                drawDate: randomDraw.drawDate
            };
        }

        res.json({
            status: 1,
            msg: "Generated Powerball suggestions successfully",
            results: {
                frequent: { balls: frequentBalls, powerball: frequentPowerball },
                infrequent: { balls: infrequentBalls, powerball: infrequentPowerball },
                mixed: { balls: mixedBalls, powerball: mixedPowerball },
                uniqueJackpot,
            }
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
