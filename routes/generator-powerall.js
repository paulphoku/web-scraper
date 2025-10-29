const express = require("express");
const axios = require("axios");
const router = express.Router();

const API_BASE = process.env.API_BASE || "localhost:3000"; // e.g., https://your-domain.com if API is separate

// Helper to build query string safely
function buildQS(params = {}) {
    const url = new URL("http://x");
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && String(v).length) url.searchParams.set(k, String(v));
    }
    return url.searchParams.toString();
}

router.get(["/", "/generator"], async (req, res) => {
    const q = {
        gameName: req.query.gameName || "powerball",
        limit: req.query.limit || 200,
        startDate: req.query.startDate || "",
        endDate: req.query.endDate || "",
        numOfSimulation: req.query.numOfSimulation || 10000,
        batchSize: req.query.batchSize || 100000,
        dateBias: req.query.dateBias || "28,10,29,25,31",
    };

    let data = null;
    let error = null;
    try {
        const qs = buildQS(q);
        const url = `${API_BASE}/api/generate?${qs}`;
        const resp = await axios.get(url, { timeout: 25_000 });
        data = resp.data;
        if (data?.status !== 1) throw new Error(data?.msg || "Failed to generate");
    } catch (e) {
        error = e.message;
    }


    // Shape model for mustache (no logic in templates)
    const model = {
        title: "PowerBall Generator · SSR (Mustache)",
        params: {
            ...q,
            startDate: q.startDate,
            endDate: q.endDate,
        },
        error,
        hasError: !!error,
        hasResults: !!data?.results?.length,
        results: (data?.results || []).map((r, i) => ({
            rank: i + 1,
            balls: r.balls.map((n) => ({ n })),
            powerball: r.powerball,
        })),
        analysis: {
            hotPower: data?.analysis?.hotPower,
            coldPower: data?.analysis?.coldPower,
            hotBalls: (data?.analysis?.hotBalls || []).map((n) => ({ n })),
            coldBalls: (data?.analysis?.coldBalls || []).map((n) => ({ n })),
            topPairs: (data?.analysis?.topPairs || []).slice(0, 10).map((arr) => ({ txt: arr.join(", ") })),
            topTriplets: (data?.analysis?.topTriplets || []).slice(0, 10).map((arr) => ({ txt: arr.join(", ") })),
        },
        meta: {
            range: data?.params ? `${data.params.startDate} → ${data.params.endDate}` : "",
            sims: data?.params?.numOfSimulation?.toLocaleString?.() || data?.params?.numOfSimulation,
            dateBias: Array.isArray(data?.params?.dateBias) ? data.params.dateBias.join(", ") : (q.dateBias || ""),
        },
    };


    res.render("generator", model);
});

module.exports = router;