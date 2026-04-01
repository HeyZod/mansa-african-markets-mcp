#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";

// ─── Config ────────────────────────────────────────────────────────────────

const NGX_BASE = "https://ngxpulse.ng/api";
const MANSA_BASE = "https://www.mansaapi.com/api/v1";

// Keys can be overridden via environment variables
const NGX_API_KEY = process.env.NGX_API_KEY || "ngxpulse_c6maakeuc936ai8r";
const MANSA_API_KEY = process.env.MANSA_API_KEY || "mansa_live_sk_wwvqfer8gumty7an";

const NGX_ATTRIBUTION = "Data powered by NGX Pulse (ngxpulse.ng)";
const MANSA_ATTRIBUTION = "Data powered by Mansa Markets (mansamarkets.com)";

// Valid Mansa API exchange IDs (from GET /api/v1/markets/exchanges)
const MANSA_EXCHANGES = [
  "nigeria",
  "ghana",
  "kenya",
  "south-africa",
  "ivory-coast",
  "tanzania",
  "zambia",
  "egypt",
  "morocco",
  "botswana",
  "mauritius",
  "zimbabwe",
  "uganda",
];

// ─── Rate limiter (60 req/min sliding window) ──────────────────────────────

const rateLimiter = {
  calls: [],
  limit: 60,
  window: 60_000,
  check() {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < this.window);
    if (this.calls.length >= this.limit) {
      throw new Error(
        `Rate limit exceeded — max ${this.limit} calls per minute. Please wait before retrying.`
      );
    }
    this.calls.push(now);
  },
};

// ─── Logger ────────────────────────────────────────────────────────────────

function log(tool, params, status) {
  process.stderr.write(
    `[${new Date().toISOString()}] tool=${tool} params=${JSON.stringify(params)} status=${status}\n`
  );
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
    headers: {
      Authorization: `Bearer ${MANSA_API_KEY}`,
      "User-Agent": "MansaMarkets-MCP/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mansa API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── NGX Pulse tool handlers ───────────────────────────────────────────────

async function getNgxMarketOverview() {
  const json = await ngxFetch("/ngxdata/market");
  const d = json.data;
  return {
    all_share_index: d.asi,
    change_percent: d.pct_change,
    market_cap: d.market_cap,
    volume: d.volume,
    deals: d.deals,
    value: d.value,
    advancers: d.advancers,
    decliners: d.decliners,
    unchanged: d.unchanged,
    updated_at: d.updated_at,
    _attribution: NGX_ATTRIBUTION,
  };
}

async function getNgxStockPrice(symbol) {
  if (!symbol) throw new Error("symbol parameter is required");
  const sym = symbol.toUpperCase();

  // Fetch both endpoints in parallel — stocks has today's live price,
  // prices has the historical close table (lags by one day until end-of-session write)
  const [stocksJson, pricesJson] = await Promise.all([
    ngxFetch("/ngxdata/stocks"),
    ngxFetch(`/ngxdata/prices/${encodeURIComponent(sym)}`),
  ]);

  const liveStock = (stocksJson.stocks ?? []).find(s => s.symbol === sym);
  const prices    = pricesJson.prices ?? [];
  const lastClose = prices[prices.length - 1] ?? {};

  return {
    symbol: sym,
    current_price:  liveStock?.current_price ?? lastClose.close_price,
    change_percent: liveStock?.change_percent ?? null,
    trade_date:     liveStock?.trade_date ?? lastClose.trade_date,
    open_price:     lastClose.open_price,
    high_price:     lastClose.high_price,
    low_price:      lastClose.low_price,
    volume:         liveStock?.volume ?? lastClose.volume,
    sector:         liveStock?.sector ?? null,
    price_history_available: prices.length,
    _attribution: NGX_ATTRIBUTION,
  };
}

async function getNgxAllStocks() {
  const json = await ngxFetch("/ngxdata/stocks");
  return {
    total: json.total_stocks,
    stocks: json.stocks,
    _attribution: NGX_ATTRIBUTION,
  };
}

async function getNgxTopGainers(limit = 10) {
  const json = await ngxFetch("/ngxdata/stocks");
  const gainers = (json.stocks ?? [])
    .filter((s) => parseFloat(s.change_percent ?? 0) > 0)
    .sort((a, b) => parseFloat(b.change_percent) - parseFloat(a.change_percent))
    .slice(0, limit)
    .map(({ symbol, name, current_price, change_percent, volume, sector }) => ({
      symbol, name, current_price, change_percent, volume, sector,
    }));
  return { gainers, count: gainers.length, _attribution: NGX_ATTRIBUTION };
}

async function getNgxTopLosers(limit = 10) {
  const json = await ngxFetch("/ngxdata/stocks");
  const losers = (json.stocks ?? [])
    .filter((s) => parseFloat(s.change_percent ?? 0) < 0)
    .sort((a, b) => parseFloat(a.change_percent) - parseFloat(b.change_percent))
    .slice(0, limit)
    .map(({ symbol, name, current_price, change_percent, volume, sector }) => ({
      symbol, name, current_price, change_percent, volume, sector,
    }));
  return { losers, count: losers.length, _attribution: NGX_ATTRIBUTION };
}

async function getNgxMarketStatus() {
  const json = await ngxFetch("/ngxdata/market-status");
  return { status: json.data.status, is_open: json.data.is_open, _attribution: NGX_ATTRIBUTION };
}

async function getNgxDisclosures() {
  const json = await ngxFetch("/ngxdata/disclosures");
  return {
    count: json.count,
    source: json.source,
    disclosures: (json.data ?? []).map(({ symbol, company, title, type, url, created }) => ({
      symbol, company, title, type, url, date: created,
    })),
    _attribution: NGX_ATTRIBUTION,
  };
}

async function getNasdStocks() {
  const json = await ngxFetch("/nasddata/stocks");
  return { total: json.total, stocks: json.stocks, _attribution: NGX_ATTRIBUTION };
}

// ─── Mansa API tool handlers ───────────────────────────────────────────────

async function getMansaExchanges() {
  const json = await mansaFetch("/markets/exchanges");
  return {
    exchanges: (json.data ?? []).map(({ id, code, name, country, currency, status, index_value, index_change_pct, stocks_count, last_updated }) => ({
      id, code, name, country, currency, status, index_value, index_change_pct, stocks_count, last_updated,
    })),
    _attribution: MANSA_ATTRIBUTION,
  };
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
  return {
    exchange: exchange.toLowerCase(),
    stocks: json.data,
    meta: json.meta,
    _attribution: MANSA_ATTRIBUTION,
  };
}

async function getMansaExchangeMovers(exchange, limit = 10, type = "both") {
  validateExchange(exchange);
  const json = await mansaFetch(
    `/markets/exchanges/${exchange.toLowerCase()}/movers?limit=${limit}&type=${type}`
  );
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

function validateExchange(exchange) {
  if (!exchange) throw new Error("exchange parameter is required");
  const ex = exchange.toLowerCase();
  if (!MANSA_EXCHANGES.includes(ex)) {
    throw new Error(
      `Invalid exchange "${exchange}". Valid options: ${MANSA_EXCHANGES.join(", ")}`
    );
  }
}

// ─── Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  // ── NGX Pulse ──
  {
    name: "get_ngx_market_overview",
    description:
      "Get a real-time overview of the Nigerian Stock Exchange (NGX). Returns the All Share Index (ASI), market capitalisation, trading volume, deals, advancers, and decliners. Use this when the user asks about the Nigerian stock market at a high level.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_ngx_stock_price",
    description:
      "Get the latest price and trading history for a specific NGX-listed stock by ticker symbol (e.g. DANGCEM, GTCO, MTNN, ZENITHBANK, ACCESSCORP). Use this when the user asks about the price of a particular Nigerian stock.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "NGX ticker symbol (e.g. DANGCEM, GTCO, MTNN). Case-insensitive.",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_ngx_all_stocks",
    description:
      "Get the full list of all 148+ equities listed on the NGX with current prices, daily change percent, volume, market cap, and sector. Use this when the user wants to browse all Nigerian stocks or run analysis across the full NGX universe.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_ngx_top_gainers",
    description:
      "Get the top gaining stocks on the NGX today, ranked by percentage price increase. Use this when the user asks which Nigerian stocks are up the most, rallying, or performing best today.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of top gainers to return. Defaults to 10." },
      },
      required: [],
    },
  },
  {
    name: "get_ngx_top_losers",
    description:
      "Get the top losing stocks on the NGX today, ranked by percentage price decline. Use this when the user asks which Nigerian stocks are down the most, falling, or underperforming today.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of top losers to return. Defaults to 10." },
      },
      required: [],
    },
  },
  {
    name: "get_ngx_market_status",
    description:
      "Check whether the Nigerian Stock Exchange (NGX) is currently open or closed. Returns OPEN, CLOSED, or ENDOFDAY. Use this to confirm live session status before quoting prices.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_ngx_disclosures",
    description:
      "Get the latest 200 corporate disclosures and regulatory announcements from NGX-listed companies — earnings results, dividends, board changes, and filings. Use this when the user asks about recent company news on the Nigerian stock market.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_nasd_stocks",
    description:
      "Get all 45 equities on Nigeria's NASD OTC Securities Exchange — the over-the-counter market for unlisted and growth-stage companies. Use this when the user asks about NASD, OTC stocks, or unlisted Nigerian securities.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  // ── Mansa API ──
  {
    name: "get_african_exchanges",
    description:
      "Get a list of all African stock exchanges covered by Mansa API, including their index levels, daily change, number of listed stocks, currency, and trading status. Covers NGX (Nigeria), GSE (Ghana), NSE (Kenya), JSE (South Africa), BRVM (West Africa), DSE (Tanzania), LuSE (Zambia), EGX (Egypt), CSE (Morocco), BSE (Botswana), SEM (Mauritius), ZSE (Zimbabwe), and USE (Uganda). Use this for a broad pan-African market overview.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_african_exchange",
    description:
      "Get detailed information for a specific African stock exchange — index value, change, trading hours, currency, status, and stocks count. Use this when the user asks about a specific African market by country.",
    inputSchema: {
      type: "object",
      properties: {
        exchange: {
          type: "string",
          enum: MANSA_EXCHANGES,
          description: `Exchange ID. Options: ${MANSA_EXCHANGES.join(", ")}`,
        },
      },
      required: ["exchange"],
    },
  },
  {
    name: "get_african_exchange_stocks",
    description:
      "Get stocks listed on a specific African exchange with prices, change percent, volume, market cap, and sector. Supports pagination and filtering by sector. Use this when the user wants to browse stocks on a non-NGX African exchange like Ghana, Kenya, or South Africa.",
    inputSchema: {
      type: "object",
      properties: {
        exchange: {
          type: "string",
          enum: MANSA_EXCHANGES,
          description: `Exchange ID. Options: ${MANSA_EXCHANGES.join(", ")}`,
        },
        limit: { type: "number", description: "Number of stocks to return. Defaults to 50." },
        sector: { type: "string", description: "Filter by sector name (optional)." },
        sort_by: {
          type: "string",
          description: "Sort field: price, change_pct, volume, market_cap (optional).",
        },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort order. Defaults to desc." },
      },
      required: ["exchange"],
    },
  },
  {
    name: "get_african_exchange_movers",
    description:
      "Get the top gaining and/or losing stocks on a specific African exchange today. Use this when the user asks about movers, gainers, or losers on a particular African market like the Ghana Stock Exchange or Nairobi Securities Exchange.",
    inputSchema: {
      type: "object",
      properties: {
        exchange: {
          type: "string",
          enum: MANSA_EXCHANGES,
          description: `Exchange ID. Options: ${MANSA_EXCHANGES.join(", ")}`,
        },
        limit: { type: "number", description: "Number of movers per category. Defaults to 10." },
        type: {
          type: "string",
          enum: ["gainers", "losers", "both"],
          description: "Which movers to return. Defaults to both.",
        },
      },
      required: ["exchange"],
    },
  },
  {
    name: "get_pan_african_movers",
    description:
      "Get the biggest stock movers across ALL African exchanges combined — the top gainers and losers by percentage change from Nigeria, Ghana, Kenya, South Africa, and every other covered market today. Use this when the user asks about the best or worst performing African stocks across the entire continent.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of movers per category. Defaults to 10." },
      },
      required: [],
    },
  },
  {
    name: "get_african_indices",
    description:
      "Get all major African stock market indices in one call — NGX ASI, GSE-CI, NASI (Kenya), J203 (JSE), BRVM-CI, LASI (Zambia), and more. Returns index values, daily change, and YTD performance. Use this when the user wants a continent-wide index comparison.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// ─── MCP Server ────────────────────────────────────────────────────────────

const server = new Server(
  { name: "mansa-african-markets-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    rateLimiter.check();
  } catch (err) {
    log(name, args, "rate_limited");
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }

  log(name, args, "start");

  try {
    let result;
    switch (name) {
      // NGX Pulse
      case "get_ngx_market_overview":      result = await getNgxMarketOverview(); break;
      case "get_ngx_stock_price":          result = await getNgxStockPrice(args.symbol); break;
      case "get_ngx_all_stocks":           result = await getNgxAllStocks(); break;
      case "get_ngx_top_gainers":          result = await getNgxTopGainers(args.limit); break;
      case "get_ngx_top_losers":           result = await getNgxTopLosers(args.limit); break;
      case "get_ngx_market_status":        result = await getNgxMarketStatus(); break;
      case "get_ngx_disclosures":          result = await getNgxDisclosures(); break;
      case "get_nasd_stocks":              result = await getNasdStocks(); break;
      // Mansa API
      case "get_african_exchanges":        result = await getMansaExchanges(); break;
      case "get_african_exchange":         result = await getMansaExchange(args.exchange); break;
      case "get_african_exchange_stocks":  result = await getMansaExchangeStocks(args.exchange, args.limit, args.sector, args.sort_by, args.order); break;
      case "get_african_exchange_movers":  result = await getMansaExchangeMovers(args.exchange, args.limit, args.type); break;
      case "get_pan_african_movers":       result = await getMansaPanAfricanMovers(args.limit); break;
      case "get_african_indices":          result = await getMansaIndices(); break;
      default: throw new Error(`Unknown tool: ${name}`);
    }

    log(name, args, "ok");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    log(name, args, `error: ${err.message}`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: err.message, tool: name },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[mansa-mcp] African Markets MCP server running — 14 tools ready\n");
