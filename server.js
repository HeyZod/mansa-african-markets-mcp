#!/usr/bin/env node

/**
 * Mansa African Markets MCP Server — HTTP mode
 * Designed for remote hosting (Digital Ocean, Railway, Render, etc.)
 */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";

// ─── Config ────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);
const NGX_BASE = "https://ngxpulse.ng/api";
const MANSA_BASE = "https://www.mansaapi.com/api/v1";
const NGX_API_KEY = process.env.NGX_API_KEY || "ngxpulse_c6maakeuc936ai8r";
const MANSA_API_KEY = process.env.MANSA_API_KEY || "mansa_live_sk_wwvqfer8gumty7an";
const NGX_ATTRIBUTION = "Data powered by NGX Pulse (ngxpulse.ng)";
const MANSA_ATTRIBUTION = "Data powered by Mansa Markets (mansamarkets.com)";
const RUNTIME_DIR = process.env.MCP_RUNTIME_DIR || path.join(process.cwd(), "runtime");
const STATS_FILE = process.env.MCP_STATS_FILE || path.join(RUNTIME_DIR, "mcp-stats.json");
const MAX_RECENT_CALLS = parseInt(process.env.MCP_MAX_RECENT_CALLS || "5000", 10);
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

const MANSA_EXCHANGES = [
  "nigeria", "ghana", "kenya", "south-africa", "ivory-coast",
  "tanzania", "zambia", "egypt", "morocco", "botswana",
  "mauritius", "zimbabwe", "uganda",
];
const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: true,
};
let supabaseClient = null;

function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

function defaultStatsStore() {
  return {
    startedAt: new Date().toISOString(),
    totals: {
      allTime: 0,
      success: 0,
      error: 0,
    },
    recentCalls: [],
  };
}

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseClient() {
  if (!hasSupabaseConfig()) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return supabaseClient;
}

function loadStatsStore() {
  try {
    ensureRuntimeDir();
    if (!fs.existsSync(STATS_FILE)) {
      return defaultStatsStore();
    }

    const parsed = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    return {
      ...defaultStatsStore(),
      ...parsed,
      recentCalls: Array.isArray(parsed?.recentCalls) ? parsed.recentCalls : [],
      totals: {
        ...defaultStatsStore().totals,
        ...(parsed?.totals || {}),
      },
    };
  } catch {
    return defaultStatsStore();
  }
}

function saveStatsStore() {
  try {
    ensureRuntimeDir();
    fs.writeFileSync(STATS_FILE, JSON.stringify(statsStore, null, 2));
  } catch (error) {
    process.stderr.write(`[mansa-mcp] failed to persist stats: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function pruneRecentCalls() {
  const cutoff = Date.now() - MAX_EVENT_AGE_MS;
  statsStore.recentCalls = (statsStore.recentCalls || [])
    .filter((call) => new Date(call.occurredAt).getTime() >= cutoff)
    .slice(-MAX_RECENT_CALLS);
}

function normalizeClient(userAgent = "") {
  const value = userAgent.toLowerCase();
  if (!value) return "Other";
  if (value.includes("claude") || value.includes("anthropic")) return "Claude";
  if (value.includes("cursor")) return "Cursor";
  if (value.includes("windsurf")) return "Windsurf";
  if (value.includes("chatgpt") || value.includes("openai")) return "ChatGPT";
  return "Other";
}

function groupCounts(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

async function persistToolCallToSupabase(event) {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client.from("mcp_call_logs").insert({
    tool_name: event.tool,
    params: event.params ? JSON.parse(event.params) : {},
    country: event.country,
    user_agent: event.userAgent,
    client: event.client,
    status: event.status,
    response_time_ms: event.responseTimeMs,
    created_at: event.occurredAt,
  });

  if (error) {
    process.stderr.write(`[mansa-mcp] failed to write Supabase log: ${error.message}\n`);
    return false;
  }

  return true;
}

async function recordToolCall(event) {
  statsStore.totals.allTime += 1;
  if (event.status === "error") {
    statsStore.totals.error += 1;
  } else {
    statsStore.totals.success += 1;
  }

  statsStore.recentCalls.push(event);
  pruneRecentCalls();
  saveStatsStore();
  await persistToolCallToSupabase(event);
}

async function getSupabaseStatsPayload() {
  const client = getSupabaseClient();
  if (!client) return null;

  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  const weekIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthIso = new Date(now - MAX_EVENT_AGE_MS).toISOString();

  const [
    allTimeCountRes,
    todayCountRes,
    weekCountRes,
    errorCountRes,
    recentRowsRes,
  ] = await Promise.all([
    client.from("mcp_call_logs").select("*", { count: "exact", head: true }),
    client.from("mcp_call_logs").select("*", { count: "exact", head: true }).gte("created_at", todayIso),
    client.from("mcp_call_logs").select("*", { count: "exact", head: true }).gte("created_at", weekIso),
    client.from("mcp_call_logs").select("*", { count: "exact", head: true }).eq("status", "error"),
    client
      .from("mcp_call_logs")
      .select("id, tool_name, params, country, user_agent, client, status, response_time_ms, created_at")
      .gte("created_at", monthIso)
      .order("created_at", { ascending: false })
      .limit(MAX_RECENT_CALLS),
  ]);

  if (recentRowsRes.error) {
    process.stderr.write(`[mansa-mcp] failed to read Supabase stats: ${recentRowsRes.error.message}\n`);
    return null;
  }

  const recentRows = recentRowsRes.data || [];
  const todayRows = recentRows.filter((row) => new Date(row.created_at).getTime() >= today.getTime());
  const weekRows = recentRows.filter((row) => new Date(row.created_at).getTime() >= new Date(weekIso).getTime());
  const successfulRows = recentRows.filter((row) => row.status !== "error");

  const hourlyMap = new Map();
  for (const row of todayRows) {
    const label = new Date(row.created_at).toISOString().slice(11, 13) + ":00";
    hourlyMap.set(label, (hourlyMap.get(label) || 0) + 1);
  }

  const dailyMap = new Map();
  for (const row of weekRows) {
    const label = new Date(row.created_at).toISOString().slice(5, 10);
    dailyMap.set(label, (dailyMap.get(label) || 0) + 1);
  }

  const allTimeCount = allTimeCountRes.count ?? 0;
  const errorCount = errorCountRes.count ?? 0;

  return {
    configured: true,
    stats: {
      today: todayCountRes.count ?? 0,
      week: weekCountRes.count ?? 0,
      allTime: allTimeCount,
      avgResponseTimeMs: successfulRows.length
        ? successfulRows.reduce((sum, row) => sum + (row.response_time_ms || 0), 0) / successfulRows.length
        : null,
      errorRate: allTimeCount ? (errorCount / allTimeCount) * 100 : null,
    },
    toolCalls: groupCounts(recentRows.map((row) => row.tool_name || "unknown")).slice(0, 10),
    hourlyTrend: Array.from(hourlyMap.entries()).map(([label, value]) => ({ label, value })),
    dailyTrend: Array.from(dailyMap.entries()).map(([label, value]) => ({ label, value })),
    geography: groupCounts(recentRows.map((row) => row.country || "Unknown")).slice(0, 10),
    userAgents: groupCounts(recentRows.map((row) => row.client || normalizeClient(row.user_agent || ""))).slice(0, 10),
    recentCalls: recentRows.slice(0, 20).map((row) => ({
      id: row.id || `${row.tool_name}-${row.created_at}`,
      tool: row.tool_name || "unknown",
      params: JSON.stringify(row.params || {}),
      occurredAt: row.created_at,
      country: row.country || "Unknown",
      userAgent: row.user_agent || "Unknown",
      client: row.client || normalizeClient(row.user_agent || ""),
      status: row.status || "ok",
      responseTimeMs: row.response_time_ms || null,
    })),
    updatedAt: new Date().toISOString(),
  };
}

async function getStatsPayload() {
  const supabasePayload = await getSupabaseStatsPayload();
  if (supabasePayload) {
    return supabasePayload;
  }

  pruneRecentCalls();

  const now = Date.now();
  const todayThreshold = new Date();
  todayThreshold.setHours(0, 0, 0, 0);
  const weekThreshold = now - 7 * 24 * 60 * 60 * 1000;
  const todayCalls = statsStore.recentCalls.filter((call) => new Date(call.occurredAt).getTime() >= todayThreshold.getTime());
  const weekCalls = statsStore.recentCalls.filter((call) => new Date(call.occurredAt).getTime() >= weekThreshold);
  const successfulCalls = statsStore.recentCalls.filter((call) => call.status !== "error");

  const hourlyMap = new Map();
  for (const call of todayCalls) {
    const label = new Date(call.occurredAt).toISOString().slice(11, 13) + ":00";
    hourlyMap.set(label, (hourlyMap.get(label) || 0) + 1);
  }

  const dailyMap = new Map();
  for (const call of weekCalls) {
    const label = new Date(call.occurredAt).toISOString().slice(5, 10);
    dailyMap.set(label, (dailyMap.get(label) || 0) + 1);
  }

  return {
    configured: true,
    stats: {
      today: todayCalls.length,
      week: weekCalls.length,
      allTime: statsStore.totals.allTime,
      avgResponseTimeMs: successfulCalls.length
        ? successfulCalls.reduce((sum, call) => sum + (call.responseTimeMs || 0), 0) / successfulCalls.length
        : null,
      errorRate: statsStore.totals.allTime
        ? (statsStore.totals.error / statsStore.totals.allTime) * 100
        : null,
    },
    toolCalls: groupCounts(statsStore.recentCalls.map((call) => call.tool)).slice(0, 10),
    hourlyTrend: Array.from(hourlyMap.entries()).map(([label, value]) => ({ label, value })),
    dailyTrend: Array.from(dailyMap.entries()).map(([label, value]) => ({ label, value })),
    geography: groupCounts(statsStore.recentCalls.map((call) => call.country || "Unknown")).slice(0, 10),
    userAgents: groupCounts(statsStore.recentCalls.map((call) => call.client || "Other")).slice(0, 10),
    recentCalls: statsStore.recentCalls.slice(-20).reverse(),
    updatedAt: new Date().toISOString(),
  };
}

const statsStore = loadStatsStore();

function formatToolResult(result) {
  const attribution = result?.attribution || result?._attribution || null;
  const structured = { ...result };

  if (attribution && !structured.attribution) {
    structured.attribution = attribution;
  }

  delete structured._attribution;

  return {
    text: attribution
      ? `${attribution}\n\n${JSON.stringify(structured, null, 2)}`
      : JSON.stringify(structured, null, 2),
    structured,
  };
}

// ─── Rate limiter (60 req/min per IP) ─────────────────────────────────────

const ipCallMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const calls = (ipCallMap.get(ip) || []).filter((t) => now - t < 60_000);
  if (calls.length >= 60) {
    throw new Error("Rate limit exceeded — max 60 calls per minute.");
  }
  calls.push(now);
  ipCallMap.set(ip, calls);
}

// ─── Logger ────────────────────────────────────────────────────────────────

function log(tool, params, status) {
  process.stdout.write(
    `[${new Date().toISOString()}] tool=${tool} params=${JSON.stringify(params)} status=${status}\n`
  );
}

function getRequestCountry(req) {
  return (
    req.headers["cf-ipcountry"] ||
    req.headers["x-vercel-ip-country"] ||
    req.headers["x-country-code"] ||
    "Unknown"
  );
}

function getRequestUserAgent(req) {
  return req.headers["user-agent"] || "Unknown";
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

async function ngxFetch(path) {
  const res = await fetch(`${NGX_BASE}${path}`, {
    headers: { "X-API-Key": NGX_API_KEY, "User-Agent": "MansaMarkets-MCP/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NGX Pulse API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function mansaFetch(path) {
  const res = await fetch(`${MANSA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${MANSA_API_KEY}`, "User-Agent": "MansaMarkets-MCP/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mansa API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── NGX Pulse handlers ────────────────────────────────────────────────────

async function getNgxMarketOverview() {
  const json = await ngxFetch("/ngxdata/market");
  const d = json.data;
  return { all_share_index: d.asi, change_percent: d.pct_change, market_cap: d.market_cap, volume: d.volume, deals: d.deals, value: d.value, advancers: d.advancers, decliners: d.decliners, unchanged: d.unchanged, updated_at: d.updated_at, _attribution: NGX_ATTRIBUTION };
}

async function getNgxStockPrice(symbol) {
  if (!symbol) throw new Error("symbol parameter is required");
  const json = await ngxFetch(`/ngxdata/prices/${encodeURIComponent(symbol.toUpperCase())}`);
  const prices = json.prices ?? [];
  const latest = prices[prices.length - 1] ?? {};
  return { symbol: json.symbol, latest_close: latest.close_price, open_price: latest.open_price, high_price: latest.high_price, low_price: latest.low_price, volume: latest.volume, trade_date: latest.trade_date, price_history_available: prices.length, _attribution: NGX_ATTRIBUTION };
}

async function getNgxAllStocks() {
  const json = await ngxFetch("/ngxdata/stocks");
  return { total: json.total_stocks, stocks: json.stocks, _attribution: NGX_ATTRIBUTION };
}

async function getNgxTopGainers(limit = 10) {
  const json = await ngxFetch("/ngxdata/stocks");
  const gainers = (json.stocks ?? []).filter(s => parseFloat(s.change_percent ?? 0) > 0).sort((a, b) => parseFloat(b.change_percent) - parseFloat(a.change_percent)).slice(0, limit).map(({ symbol, name, current_price, change_percent, volume, sector }) => ({ symbol, name, current_price, change_percent, volume, sector }));
  return { gainers, count: gainers.length, _attribution: NGX_ATTRIBUTION };
}

async function getNgxTopLosers(limit = 10) {
  const json = await ngxFetch("/ngxdata/stocks");
  const losers = (json.stocks ?? []).filter(s => parseFloat(s.change_percent ?? 0) < 0).sort((a, b) => parseFloat(a.change_percent) - parseFloat(b.change_percent)).slice(0, limit).map(({ symbol, name, current_price, change_percent, volume, sector }) => ({ symbol, name, current_price, change_percent, volume, sector }));
  return { losers, count: losers.length, _attribution: NGX_ATTRIBUTION };
}

async function getNgxMarketStatus() {
  const json = await ngxFetch("/ngxdata/market-status");
  return { status: json.data.status, is_open: json.data.is_open, _attribution: NGX_ATTRIBUTION };
}

async function getNgxDisclosures() {
  const json = await ngxFetch("/ngxdata/disclosures");
  return { count: json.count, source: json.source, disclosures: (json.data ?? []).map(({ symbol, company, title, type, url, created }) => ({ symbol, company, title, type, url, date: created })), _attribution: NGX_ATTRIBUTION };
}

async function getNasdStocks() {
  const json = await ngxFetch("/nasddata/stocks");
  return { total: json.total, stocks: json.stocks, _attribution: NGX_ATTRIBUTION };
}

// ─── Mansa API handlers ────────────────────────────────────────────────────

function validateExchange(exchange) {
  if (!exchange) throw new Error("exchange parameter is required");
  const ex = exchange.toLowerCase();
  if (!MANSA_EXCHANGES.includes(ex)) throw new Error(`Invalid exchange "${exchange}". Valid: ${MANSA_EXCHANGES.join(", ")}`);
}

async function getMansaExchanges() {
  const json = await mansaFetch("/markets/exchanges");
  return { exchanges: (json.data ?? []).map(({ id, code, name, country, currency, status, index_value, index_change_pct, stocks_count, last_updated }) => ({ id, code, name, country, currency, status, index_value, index_change_pct, stocks_count, last_updated })), _attribution: MANSA_ATTRIBUTION };
}

async function getMansaExchange(exchange) {
  validateExchange(exchange);
  const json = await mansaFetch(`/markets/exchanges/${exchange.toLowerCase()}`);
  return { ...json.data, _attribution: MANSA_ATTRIBUTION };
}

async function getMansaExchangeStocks(exchange, limit = 50, sector, sort_by, order) {
  validateExchange(exchange);
  const params = new URLSearchParams();
  if (limit) params.set("limit", limit);
  if (sector) params.set("sector", sector);
  if (sort_by) params.set("sort_by", sort_by);
  if (order) params.set("order", order);
  const qs = params.toString() ? `?${params}` : "";
  const json = await mansaFetch(`/markets/exchanges/${exchange.toLowerCase()}/stocks${qs}`);
  return { exchange: exchange.toLowerCase(), stocks: json.data, meta: json.meta, _attribution: MANSA_ATTRIBUTION };
}

async function getMansaExchangeMovers(exchange, limit = 10, type = "both") {
  validateExchange(exchange);
  const json = await mansaFetch(`/markets/exchanges/${exchange.toLowerCase()}/movers?limit=${limit}&type=${type}`);
  return { exchange: exchange.toLowerCase(), ...json.data, meta: json.meta, _attribution: MANSA_ATTRIBUTION };
}

async function getMansaPanAfricanMovers(limit = 10) {
  const json = await mansaFetch(`/markets/movers/pan-african?limit=${limit}`);
  return { ...json.data, meta: json.meta, _attribution: MANSA_ATTRIBUTION };
}

async function getMansaIndices() {
  const json = await mansaFetch("/markets/indices");
  return { indices: json.data, _attribution: MANSA_ATTRIBUTION };
}

// ─── Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  { name: "get_ngx_market_overview", description: "Get a real-time overview of the Nigerian Stock Exchange (NGX). Returns the All Share Index (ASI), market capitalisation, trading volume, deals, advancers, and decliners. Use this when the user asks about the Nigerian stock market at a high level.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "get_ngx_stock_price", description: "Get the latest price and trading history for a specific NGX-listed stock by ticker symbol (e.g. DANGCEM, GTCO, MTNN, ZENITHBANK, ACCESSCORP). Use this when the user asks about the price of a particular Nigerian stock.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: { symbol: { type: "string", description: "NGX ticker symbol (e.g. DANGCEM, GTCO, MTNN). Case-insensitive." } }, required: ["symbol"] } },
  { name: "get_ngx_all_stocks", description: "Get the full list of all 148+ equities listed on the NGX with current prices, daily change percent, volume, market cap, and sector.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "get_ngx_top_gainers", description: "Get the top gaining stocks on the NGX today, ranked by percentage price increase. Use this when the user asks which Nigerian stocks are up the most today.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: { limit: { type: "number", description: "Number of top gainers to return. Defaults to 10." } }, required: [] } },
  { name: "get_ngx_top_losers", description: "Get the top losing stocks on the NGX today, ranked by percentage price decline. Use this when the user asks which Nigerian stocks are down the most today.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: { limit: { type: "number", description: "Number of top losers to return. Defaults to 10." } }, required: [] } },
  { name: "get_ngx_market_status", description: "Check whether the Nigerian Stock Exchange (NGX) is currently open or closed. Returns OPEN, CLOSED, or ENDOFDAY.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "get_ngx_disclosures", description: "Get the latest 200 corporate disclosures and regulatory announcements from NGX-listed companies.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "get_nasd_stocks", description: "Get all 45 equities on Nigeria's NASD OTC Securities Exchange.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "get_african_exchanges", description: "Get a list of all African stock exchanges covered by Mansa API — NGX, GSE, NSE, JSE, BRVM, DSE, LuSE, EGX, CSE, BSE, SEM, ZSE, USE — with index levels, daily change, stocks count, and status.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "get_african_exchange", description: "Get detailed data for one specific African exchange by ID — index value, change, trading hours, currency, and status.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: { exchange: { type: "string", enum: MANSA_EXCHANGES, description: `Exchange ID. Options: ${MANSA_EXCHANGES.join(", ")}` } }, required: ["exchange"] } },
  { name: "get_african_exchange_stocks", description: "Get stocks on a specific African exchange with prices, change percent, volume, market cap, and sector. Supports filtering and sorting.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: { exchange: { type: "string", enum: MANSA_EXCHANGES, description: `Exchange ID. Options: ${MANSA_EXCHANGES.join(", ")}` }, limit: { type: "number", description: "Number of stocks to return. Defaults to 50." }, sector: { type: "string", description: "Filter by sector (optional)." }, sort_by: { type: "string", description: "Sort by: price, change_pct, volume, market_cap (optional)." }, order: { type: "string", enum: ["asc", "desc"], description: "Sort order. Defaults to desc." } }, required: ["exchange"] } },
  { name: "get_african_exchange_movers", description: "Get the top gainers and/or losers on a specific African exchange today.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: { exchange: { type: "string", enum: MANSA_EXCHANGES, description: `Exchange ID. Options: ${MANSA_EXCHANGES.join(", ")}` }, limit: { type: "number", description: "Number of movers per category. Defaults to 10." }, type: { type: "string", enum: ["gainers", "losers", "both"], description: "Which movers to return. Defaults to both." } }, required: ["exchange"] } },
  { name: "get_pan_african_movers", description: "Get the biggest stock movers across ALL African exchanges combined — top gainers and losers by % change from every covered market today.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: { limit: { type: "number", description: "Number of movers per category. Defaults to 10." } }, required: [] } },
  { name: "get_african_indices", description: "Get all major African market indices in one call — NGX ASI, GSE-CI, NASI, J203, BRVM-CI, LASI and more.", annotations: TOOL_ANNOTATIONS, inputSchema: { type: "object", properties: {}, required: [] } },
];

// ─── MCP server factory ────────────────────────────────────────────────────

function buildMcpServer(requestMeta = {}) {
  const server = new Server({ name: "mansa-african-markets-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    log(name, args, "start");
    const startedAt = Date.now();
    try {
      let result;
      switch (name) {
        case "get_ngx_market_overview":     result = await getNgxMarketOverview(); break;
        case "get_ngx_stock_price":         result = await getNgxStockPrice(args.symbol); break;
        case "get_ngx_all_stocks":          result = await getNgxAllStocks(); break;
        case "get_ngx_top_gainers":         result = await getNgxTopGainers(args.limit); break;
        case "get_ngx_top_losers":          result = await getNgxTopLosers(args.limit); break;
        case "get_ngx_market_status":       result = await getNgxMarketStatus(); break;
        case "get_ngx_disclosures":         result = await getNgxDisclosures(); break;
        case "get_nasd_stocks":             result = await getNasdStocks(); break;
        case "get_african_exchanges":       result = await getMansaExchanges(); break;
        case "get_african_exchange":        result = await getMansaExchange(args.exchange); break;
        case "get_african_exchange_stocks": result = await getMansaExchangeStocks(args.exchange, args.limit, args.sector, args.sort_by, args.order); break;
        case "get_african_exchange_movers": result = await getMansaExchangeMovers(args.exchange, args.limit, args.type); break;
        case "get_pan_african_movers":      result = await getMansaPanAfricanMovers(args.limit); break;
        case "get_african_indices":          result = await getMansaIndices(); break;
        default: throw new Error(`Unknown tool: ${name}`);
      }
      log(name, args, "ok");
      await recordToolCall({
        id: `${name}-${Date.now()}`,
        tool: name,
        params: JSON.stringify(args),
        occurredAt: new Date().toISOString(),
        country: requestMeta.country || "Unknown",
        userAgent: requestMeta.userAgent || "Unknown",
        client: requestMeta.client || "Other",
        status: "ok",
        responseTimeMs: Date.now() - startedAt,
      });
      const formatted = formatToolResult(result);
      return {
        content: [{ type: "text", text: formatted.text }],
        structuredContent: formatted.structured,
      };
    } catch (err) {
      log(name, args, `error: ${err.message}`);
      await recordToolCall({
        id: `${name}-${Date.now()}`,
        tool: name,
        params: JSON.stringify(args),
        occurredAt: new Date().toISOString(),
        country: requestMeta.country || "Unknown",
        userAgent: requestMeta.userAgent || "Unknown",
        client: requestMeta.client || "Other",
        status: "error",
        responseTimeMs: Date.now() - startedAt,
      });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message, tool: name }, null, 2) }], isError: true };
    }
  });

  return server;
}

// ─── Express app ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "mansa-african-markets-mcp", version: "1.0.0", tools: TOOLS.length });
});

app.get("/stats", (_req, res) => {
  getStatsPayload()
    .then((payload) => res.json(payload))
    .catch((error) => {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load stats" });
    });
});

app.post("/mcp", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  try { checkRateLimit(String(ip)); } catch (err) { return res.status(429).json({ error: err.message }); }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const userAgent = getRequestUserAgent(req);
  const server = buildMcpServer({
    country: getRequestCountry(req),
    userAgent,
    client: normalizeClient(String(userAgent)),
  });
  res.on("close", () => transport.close());

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/mcp", (_req, res) => { res.status(405).json({ error: "Method not allowed. Use POST /mcp" }); });
app.delete("/mcp", (_req, res) => { res.status(405).json({ error: "Method not allowed." }); });

app.listen(PORT, () => {
  process.stdout.write(`[mansa-mcp] HTTP server running on port ${PORT} — 14 tools ready\n`);
});
