/**
 * proshare.js
 * -----------
 * Scrapes the Proshare weekly stock recommendation article using Playwright
 * (required because Proshare blocks plain HTTP clients with 403).
 *
 * Sends raw article HTML to Claude for structured extraction.
 *
 * Returns: Array of { ticker, broker, action, entryPrice, targetPrice, upside, weekKey }
 */

import { chromium } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import { buildProshareUrlCandidates, getThisMonday, getWeekKey } from "../utils/dates.js";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Playwright scrape ────────────────────────────────────────────────────────

async function fetchProshareArticle(url) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-NG",
  });

  const page = await context.newPage();

  // Block fonts/css/media for speed. Allow images — we need to measure them
  // to find the CMO recommendations table image (which is taller than banners).
  await page.route("**/*", (route) => {
    const resourceType = route.request().resourceType();
    if (["font", "stylesheet", "media"].includes(resourceType)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  console.log(`[Proshare] Navigating to: ${url}`);

  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  if (!response.ok()) {
    await browser.close();
    throw new Error(`Proshare returned HTTP ${response.status()} for ${url}`);
  }

  // Wait for the article body to render
  await page.waitForSelector("article, .article-content, .content-body, main", {
    timeout: 15_000,
  }).catch(() => {
    // Non-fatal — proceed anyway
    console.warn("[Proshare] Could not detect article selector, extracting all body text");
  });

  // Extract meaningful text content (strip nav/footer noise)
  const articleText = await page.evaluate(() => {
    // Try specific article containers first
    const selectors = [
      ".article-content",
      ".content-body",
      ".post-content",
      "article",
      "#content",
      "main",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.innerText;
    }
    return document.body.innerText;
  });

  // Wait briefly for content images to load so naturalWidth/Height are populated
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  // Find the table image — Proshare hosts CMO Stock Recommendations table as a PNG
  // on prjdg-unstruc.s3.ca-central-1.amazonaws.com/Image/News/<hash>
  const allImages = await page.evaluate(() => {
    return Array.from(document.images)
      .map((img) => ({ src: img.src, width: img.naturalWidth, height: img.naturalHeight }))
      .filter((i) => i.src && !i.src.includes("assets/img") && !i.src.startsWith("data:"));
  });
  console.log(`[Proshare] Found ${allImages.length} content images`);
  allImages.forEach((i) => console.log(`  - ${i.width}×${i.height} ${i.src.slice(-80)}`));

  // Heuristic for the CMO Stock Recommendations table image:
  //  - Hosted at Proshare's S3 (prjdg-unstruc) or ERP image bucket
  //  - Aspect ratio: TALL (height > width) — banners are wide, the table is tall
  //  - Has substantial size (at least 200×400)
  // Banner ads are wide promos; the table is a vertical multi-row matrix.
  const tableCandidate = allImages
    .filter((i) => i.src.includes("prjdg-unstruc.s3") || i.src.includes("erpapi.proshare"))
    .filter((i) => i.height > i.width && i.width >= 200 && i.height >= 400)
    .sort((a, b) => (b.height * b.width) - (a.height * a.width))[0];

  await browser.close();
  return { articleText, tableImageUrl: tableCandidate?.src || null };
}

async function downloadImageBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Infer media type from URL or default to png (Proshare's S3 images are PNG)
  const contentType = res.headers.get("content-type") || "image/png";
  return { mediaType: contentType.split(";")[0].trim(), data: buf.toString("base64") };
}

// ─── Claude extraction ────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a financial data extraction expert. Extract ALL broker stock recommendations from the inputs below.

You are given:
1. An IMAGE of a structured table titled "CMO STOCK RECOMMENDATIONS" — this is the AUTHORITATIVE source of every broker x ticker rating for the week. Read every cell of the table.
2. The article narrative text — use this to ENRICH rows with target_price, entryPrice and upside percentages where the prose mentions them.

The data is from the Nigerian stock market (NGX).

For EVERY (broker, ticker) cell in the table image with a non-empty rating (not "-" and not "UR"), output one recommendation row, even when the prose doesn't mention it.

For EVERY recommendation row, extract:
- ticker: NGX stock ticker (e.g. ZENITHBANK, GTCO, MTNN, DANGCEM)
- companyName: Full company name (e.g. "Zenith Bank Plc", "MTN Nigeria Communications") — null if unclear
- sector: One of: Banking, Consumer Goods, Industrial Goods, Insurance, Oil & Gas, Agriculture, ICT, Conglomerates, Services, Healthcare, Utilities, Other (null if unclear)
- broker: The brokerage firm name (e.g. Meristem, Afrinvest, CardinalStone, Chapel Hill, PAC Research, Lead Capital, Apel, FutureView, Bancorp Securities, BlueMarina, Vetiva, Cordros, ARM Securities, FSDH, United Capital, Stanbic IBTC). Normalize "Capital Bancorp" → "Bancorp Securities".
- action: One of exactly: BUY, SELL, or HOLD
- entryPrice: Entry/current price in Naira as a number (null if not specified)
- targetPrice: Target/fair value price in Naira as a number (null if not specified)
- upside: Upside/downside percentage as a number e.g. 15.4 means +15.4%, -8.2 means -8.2% (null if not specified)

Rules:
- "Accumulate" / "Accum" / "Add" = BUY
- "Reduce" / "Trim" = SELL
- "Neutral" = HOLD
- "UR" or "Under Review" = SKIP (do not output)
- "-" or empty cell = SKIP
- Include EVERY broker × ticker pair from the table image that has a real rating
- Only ONE row per (broker, ticker) — never emit duplicates

Return ONLY a valid JSON array. No markdown. No explanation. Example:
[
  {"ticker":"ZENITHBANK","companyName":"Zenith Bank Plc","sector":"Banking","broker":"Meristem","action":"BUY","entryPrice":38.50,"targetPrice":45.00,"upside":16.9},
  {"ticker":"DANGCEM","companyName":"Dangote Cement Plc","sector":"Industrial Goods","broker":"Afrinvest","action":"SELL","entryPrice":412.00,"targetPrice":368.00,"upside":-10.6}
]

Article narrative text:
`;

async function extractWithClaude(articleText, weekKey, tableImageUrl) {
  console.log(`[Claude] Extracting recommendations for week ${weekKey}...`);
  console.log(`[Claude] Article length: ${articleText.length} chars`);

  const truncated = articleText.slice(0, 80_000);
  const userContent = [];

  if (tableImageUrl) {
    console.log(`[Claude] Downloading table image: ${tableImageUrl}`);
    const { mediaType, data } = await downloadImageBase64(tableImageUrl);
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data },
    });
    userContent.push({ type: "text", text: EXTRACTION_PROMPT + truncated });
  } else {
    console.warn("[Claude] No table image found — falling back to text-only extraction (will only capture prose-mentioned revisions)");
    userContent.push({ type: "text", text: EXTRACTION_PROMPT + truncated });
  }

  const message = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16384,
    messages: [{ role: "user", content: userContent }],
  });

  if (message.stop_reason === "max_tokens") {
    console.warn("[Claude] Response hit max_tokens — output may be truncated");
  }

  const raw = message.content[0].text.trim();

  // Robust JSON extraction: find the outermost [...] array
  let cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("[Claude] JSON parse failed. Raw output:", raw.slice(0, 800));
    throw new Error(`Claude returned invalid JSON: ${e.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Claude extraction returned non-array JSON");
  }

  console.log(`[Claude] Extracted ${parsed.length} recommendations`);

  // Stamp with weekKey and normalize
  return parsed.map((row) => ({
    weekKey,
    ticker: row.ticker?.toUpperCase().trim(),
    companyName: row.companyName?.trim() || null,
    sector: row.sector?.trim() || null,
    broker: row.broker?.trim(),
    action: row.action?.toUpperCase().trim(),
    entryPrice: typeof row.entryPrice === "number" ? row.entryPrice : null,
    targetPrice: typeof row.targetPrice === "number" ? row.targetPrice : null,
    upside: typeof row.upside === "number" ? row.upside : null,
    source: "proshare",
    scrapedAt: new Date().toISOString(),
  }));
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {Date} [forDate] - defaults to this Monday
 * @returns {Promise<Array>} Structured recommendation rows
 */
export async function scrapeProshare(forDate) {
  const monday = getThisMonday(forDate);
  const weekKey = getWeekKey(monday);
  const candidates = buildProshareUrlCandidates(monday);

  let articleText, tableImageUrl, lastError;
  for (const url of candidates) {
    try {
      console.log(`[Proshare] Trying ${url}`);
      const fetched = await fetchProshareArticle(url);
      // A real article has substantive body text; a 404/stub page does not.
      if ((fetched.articleText || "").length >= 200) {
        articleText = fetched.articleText;
        tableImageUrl = fetched.tableImageUrl;
        if (tableImageUrl) console.log(`[Proshare] Table image: ${tableImageUrl}`);
        break;
      }
      lastError = new Error(`Article text suspiciously short (${(fetched.articleText || "").length} chars) at ${url}`);
      console.warn(`[Proshare] ${lastError.message} — trying next URL form`);
    } catch (err) {
      lastError = err;
      console.warn(`[Proshare] Fetch failed for ${url}: ${err.message} — trying next URL form`);
    }
  }

  if (!articleText) {
    const err = lastError || new Error("No article found at any URL form");
    console.error(`[Proshare] Scrape failed: ${err.message}`);
    throw err;
  }

  const raw = await extractWithClaude(articleText, weekKey, tableImageUrl);

  // Dedupe by (ticker, broker) — keep the first occurrence
  const seen = new Set();
  const deduped = [];
  for (const row of raw) {
    const key = `${(row.ticker || "").toUpperCase()}|${(row.broker || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  if (deduped.length !== raw.length) {
    console.log(`[Proshare] Deduped ${raw.length - deduped.length} duplicate (ticker, broker) pairs`);
  }
  return deduped;
}

// ─── CLI test ─────────────────────────────────────────────────────────────────
// Run: node src/scrapers/proshare.js

if (process.argv[1].includes("proshare.js")) {
  import("dotenv").then(({ config }) => config());
  scrapeProshare()
    .then((rows) => {
      console.log("\n✅ Extracted recommendations:");
      console.table(rows.slice(0, 10));
      console.log(`\nTotal: ${rows.length} rows`);
    })
    .catch((e) => {
      console.error("❌ Error:", e.message);
      process.exit(1);
    });
}
