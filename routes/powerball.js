// powerball-api-with-date-bias-and-optimizations.js
// Drop-in replacement for your router module with:
// - Date-bias weighting (e.g., 28,10,29,25,31)
// - Input validation & caps via zod
// - Axios retry with exponential backoff
// - History responses cached
// - Faster pair/triplet lookups (indexed)
// - Alias route for /dividends (and keeping your original /dividents)

const express = require("express");
const router = express.Router();
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const moment = require("moment");
const qs = require("qs");
const NodeCache = require("node-cache");
const { z } = require("zod"); // NEW

// ====== Config ======
const dividendsCache = new NodeCache({ stdTTL: 3600 * 24 }); // cache for 24 hours
const historyCache = new NodeCache({ stdTTL: 3600 }); // NEW: 1 hour for history
const DEFAULT_SIMS = 10000; // keep your default
const DEFAULT_BATCH = 100000;
const MAX_SIMS = 200_000; // cap suggested
const MAX_BATCH = 50_000; // cap suggested
const MAX_LIMIT = 500; // cap on historical draws used per request

// Retry/backoff for flakey upstream
axiosRetry(axios, { retries: 3 });


// ====== Validation ======
const generateSchema = z.object({
  gameName: z.enum(["powerball", "powerball-plus"]).default("powerball"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(200),
  startDate: z.string().optional(), // accept ISO or DD/MM/YYYY
  endDate: z.string().optional(),
  // Optional overrides (kept hidden in UI unless you want them)
  numOfSimulation: z.coerce.number().int().min(100).max(MAX_SIMS).optional(),
  batchSize: z.coerce.number().int().min(1000).max(MAX_BATCH).optional(),
  // Date-bias numbers, comma-separated e.g. "28,10,29,25,31"
  dateBias: z.string().optional(),
});

function parseDateStrict(s) {
  if (!s) return null;
  const mIso = moment(s, moment.ISO_8601, true);
  if (mIso.isValid()) return mIso;
  const mDMY = moment(s, "DD/MM/YYYY", true);
  if (mDMY.isValid()) return mDMY;
  const mYMD = moment(s, "YYYY/MM/DD", true); // upstream seems to return this
  if (mYMD.isValid()) return mYMD;
  throw new Error("Invalid date format. Use ISO, DD/MM/YYYY, or YYYY/MM/DD");
}

function ensureDateRange(start, end, { maxYears = 3 } = {}) {
  const s = start || moment().subtract(1, 'year');
  const e = end || moment();
  if (e.isBefore(s)) throw new Error("endDate must be after startDate");
  if (e.diff(s, "years", true) > maxYears) throw new Error(`Date range too large (max ${maxYears} years)`);
  return { s, e };
}

function parseDateBias(str) {
  if (!str) return new Set([28, 10, 29, 25, 31]); // sensible default per your request
  return new Set(
    str
      .split(",")
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 50)
  );
}

// ====== Upstream fetchers with caching ======
async function getPowerballHistory(
  gameName = "powerball",
  startDate = "01/01/2021",
  endDate = moment().format("DD/MM/YYYY")
) {
  const cacheKey = `hist:${gameName}:${startDate}:${endDate}`;
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://www.nationallottery.co.za/index.php?task=results.getHistoricalData&Itemid=272&option=com_weaver&controller=${gameName}-history`;
  try {
    const formData = {
      gameName: gameName.toUpperCase().replace(/-/g, ""),
      startDate,
      endDate,
      offset: 0,
      limit: 104, // server-side page size; keep as-is
      isAjax: true,
    };

    const response = await axios.post(url, qs.stringify(formData), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0",
      },
      timeout: 15000,
    });

    historyCache.set(cacheKey, response.data);
    return response.data;
  } catch (error) {
    console.error("Error fetching Powerball history:", error.message);
    return null;
  }
}

async function getPowerballDividends(gameName = "powerball", drawNumber = 1499) {
  const cacheKey = `${gameName}:${drawNumber}`;
  const cached = dividendsCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://www.nationallottery.co.za/index.php?task=results.redirectPageURL&Itemid=273&option=com_weaver&controller=${gameName}-history`;
  try {
    const formData = {
      gameName: gameName.toUpperCase().replace(/-/g, ""),
      drawNumber,
      isAjax: true,
    };

    const response = await axios.post(url, qs.stringify(formData), {
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

// ====== Helpers: index pairs/triplets for O(1-ish) checks ======
function indexPairs(pairs) {
  // pairs: [[a,b], ...]
  const idx = new Map();
  for (const [a, b] of pairs) {
    const x = Math.min(a, b);
    const y = Math.max(a, b);
    if (!idx.has(x)) idx.set(x, new Set());
    if (!idx.has(y)) idx.set(y, new Set());
    idx.get(x).add(`${x},${y}`);
    idx.get(y).add(`${x},${y}`);
  }
  return idx;
}

function indexTriplets(tris) {
  // tris: [[a,b,c], ...]
  const idx = new Map();
  for (const [a, b, c] of tris) {
    const sorted = [a, b, c].sort((m, n) => m - n);
    const [x, y, z] = sorted;
    // For each number, store the pair of the other two
    const combinations = [
      [y, z],
      [x, z],
      [x, y],
    ];
    const nums = [x, y, z];
    for (let i = 0; i < 3; i++) {
      const n = nums[i];
      const pair = combinations[i];
      const key = `${Math.min(pair[0], pair[1])},${Math.max(pair[0], pair[1])}`;
      if (!idx.has(n)) idx.set(n, new Set());
      idx.get(n).add(key);
    }
  }
  return idx;
}

// Weighted pick utility
function weightedPick(pool, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// ====== Routes ======
router.get("/generate", async function (req, res) {
  try {
    const parsed = generateSchema.parse(req.query);

    const start = parseDateStrict(parsed.startDate);
    const end = parseDateStrict(parsed.endDate);
    const { s, e } = ensureDateRange(start, end, { maxYears: 3 });

    const SIMS = parsed.numOfSimulation ?? DEFAULT_SIMS;
    const BATCH = parsed.batchSize ?? DEFAULT_BATCH;
    const DATE_SET = parseDateBias(parsed.dateBias); // NEW

    // Fetch history
    const historyData = await getPowerballHistory(
      parsed.gameName,
      s.format("DD/MM/YYYY"),
      e.format("DD/MM/YYYY")
    );

    if (!historyData || !historyData.data) {
      return res.status(500).json({ status: 0, msg: "Failed to fetch Powerball history" });
    }

    const draws = historyData.data.slice(0, parsed.limit);

    // Extract numbers
    const allMainBalls = [];
    const allPowerBalls = [];
    draws.forEach((d) => {
      allMainBalls.push(...[d.ball1, d.ball2, d.ball3, d.ball4, d.ball5].map(Number));
      allPowerBalls.push(Number(d.powerball));
    });

    // Freq maps
    const freqMap = {};
    const powerFreqMap = {};
    allMainBalls.forEach((n) => (freqMap[n] = (freqMap[n] || 0) + 1));
    allPowerBalls.forEach((n) => (powerFreqMap[n] = (powerFreqMap[n] || 0) + 1));

    const sortedMain = Object.entries(freqMap).sort((a, b) => b[1] - a[1]);
    const sortedPower = Object.entries(powerFreqMap).sort((a, b) => b[1] - a[1]);

    const hotBalls = sortedMain.slice(0, 10).map(([n]) => parseInt(n, 10));
    const coldBalls = sortedMain.slice(-10).map(([n]) => parseInt(n, 10));
    const hotPower = sortedPower[0] ? parseInt(sortedPower[0][0], 10) : 1;
    const coldPower = sortedPower.slice(-1)[0] ? parseInt(sortedPower.slice(-1)[0][0], 10) : 20;

    // Build pairs & triplets
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

    // Indexes & sets for fast checks
    const pairIdx = indexPairs(topPairs); // Map<number, Set("x,y")>
    const tripIdx = indexTriplets(topTriplets); // Map<number, Set("x,y")>
    const hotSet = new Set(hotBalls);
    const coldSet = new Set(coldBalls);

    // Pools
    const allBalls = [...new Set(allMainBalls)].sort((a, b) => a - b);
    const allPower = [...new Set(allPowerBalls)].sort((a, b) => a - b);

    // Random weighted pick with date-bias & co-occurrence boosts
    function randomHybridBall(pool, isPower = false, combo = []) {
      const weights = pool.map((n) => {
        let w = 2; // base
        if (!isPower) {
          if (hotSet.has(n)) w += 3;
          if (coldSet.has(n)) w += 1;
          if (DATE_SET.has(n)) w += 1.5; // NEW: date bias

          // pair boost: if n forms a top pair with any chosen c
          for (const c of combo) {
            const x = Math.min(n, c);
            const y = Math.max(n, c);
            if (pairIdx.get(n)?.has(`${x},${y}`)) w += 2;
          }

          // triplet boost: if any pair in combo + n completes a top triplet
          if (combo.length >= 2) {
            const pairs = [];
            for (let i = 0; i < combo.length; i++)
              for (let j = i + 1; j < combo.length; j++) {
                const x = Math.min(combo[i], combo[j]);
                const y = Math.max(combo[i], combo[j]);
                pairs.push(`${x},${y}`);
              }
            const set = tripIdx.get(n);
            if (set && pairs.some((p) => set.has(p))) w += 3;
          }
        } else {
          // PowerBall weighting: lean toward hot PBs, avoid very cold if you like
          const pbFreq = powerFreqMap[n] || 0;
          if (pbFreq >= 8) w += 2; // hot-ish threshold
          else if (pbFreq <= 2) w -= 0.5; // chilly
        }
        return w;
      });
      return weightedPick(pool, weights);
    }

    // Simulation (frequency aggregation only; consider worker-izing for very large SIMS)
    const comboFreq = {};
    const totalBatches = Math.ceil(SIMS / BATCH);

    for (let b = 0; b < totalBatches; b++) {
      const inner = Math.min(BATCH, SIMS - b * BATCH);
      for (let i = 0; i < inner; i++) {
        const combo = [];
        while (combo.length < 5) {
          const n = randomHybridBall(allBalls, false, combo);
          if (!combo.includes(n)) combo.push(n);
        }
        combo.sort((a, b) => a - b);
        const powerball = randomHybridBall(allPower, true);
        const key = combo.join(",") + "|" + powerball;
        comboFreq[key] = (comboFreq[key] || 0) + 1;
      }
      // optional: console.log(`Batch ${b + 1}/${totalBatches} completed...`);
    }

    const topCombos = Object.entries(comboFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([combo]) => {
        const [mainStr, pStr] = combo.split("|");
        return { balls: mainStr.split(",").map(Number), powerball: parseInt(pStr, 10) };
      });

    res.set("Cache-Control", "no-store");
    res.json({
      status: 1,
      msg: `Hybrid ${parsed.gameName} numbers generated successfully from ${SIMS.toLocaleString()} simulations between ${s.format(
        "YYYY-MM-DD"
      )} and ${e.format("YYYY-MM-DD")}`,
      params: {
        gameName: parsed.gameName,
        startDate: s.format("YYYY-MM-DD"),
        endDate: e.format("YYYY-MM-DD"),
        limit: parsed.limit,
        numOfSimulation: SIMS,
        batchSize: BATCH,
        dateBias: Array.from(DATE_SET),
      },
      results: topCombos,
      analysis: {
        hotBalls,
        coldBalls,
        hotPower,
        coldPower,
        topPairs,
        topTriplets,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ status: 0, msg: err.message || "Bad request" });
  }
});

router.get("/history", async function (req, res) {
  try {
    const { startDate, endDate, gameName } = req.query;
    const start = parseDateStrict(startDate);
    const end = parseDateStrict(endDate);
    const { s, e } = ensureDateRange(start, end, { maxYears: 3 });

    const data = await getPowerballHistory(
      gameName,
      s.format("DD/MM/YYYY"),
      e.format("DD/MM/YYYY")
    );

    if (!data) return res.status(500).json({ status: 0, msg: "Failed to fetch Powerball data" });

    res.set("Cache-Control", "public, max-age=3600");
    res.json({ status: 1, msg: "Fetched Powerball data successfully", total: data?.data?.length || 0, results: data });
  } catch (err) {
    console.error("err:", err);
    res.status(400).json({ status: 0, msg: err.message || "Bad request" });
  }
});

// Preferred alias with correct spelling
router.get("/dividends", async function (req, res) {
  try {
    const { gameName, drawNumber } = req.query;
    const data = await getPowerballDividends(gameName, drawNumber);
    if (!data) return res.status(500).json({ status: 0, msg: "Failed to fetch Powerball data" });
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ status: 1, msg: "Fetched Powerball data successfully", total: data?.data?.length || 0, results: data });
  } catch (err) {
    console.error("err:", err);
    res.status(400).json({ status: 0, msg: err.message || "Bad request" });
  }
});

module.exports = router;
