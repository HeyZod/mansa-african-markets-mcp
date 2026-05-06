# Mansa African Markets MCP Server

Real-time African stock market data for AI assistants, powered by [NGX Pulse](https://ngxpulse.ng) and [Mansa Markets](https://www.mansamarkets.com).

14 tools. 13 African exchanges. Live data.

[![MCP Registry](https://img.shields.io/badge/Anthropic%20MCP%20Registry-Listed-blue)](https://github.com/anthropics/mcp-registry)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Smithery](https://img.shields.io/badge/Smithery-Listed-purple)](https://smithery.ai)

---

## Quickstart (30 seconds)

Remote MCP, no installation needed:

```text
https://mcp.mansamarkets.com/mcp
```

Add to Claude.ai, Cursor, or any MCP-compatible client and start querying African markets immediately.

---

## Tools

### NGX Pulse — Nigerian Market Data

| Tool | Description |
|------|-------------|
| `get_ngx_market_overview` | All Share Index, market cap, volume, advancers/decliners |
| `get_ngx_stock_price` | Price history for any NGX ticker (DANGCEM, GTCO, MTNN…) |
| `get_ngx_all_stocks` | Full 148-stock NGX equities list with live prices |
| `get_ngx_top_gainers` | Top N NGX stocks by % gain today |
| `get_ngx_top_losers` | Top N NGX stocks by % loss today |
| `get_ngx_market_status` | NGX session status (OPEN / CLOSED / ENDOFDAY) |
| `get_ngx_disclosures` | Latest 200 corporate announcements |
| `get_nasd_stocks` | NASD OTC market equities (45 stocks) |

### Mansa Markets — Pan-African Data

| Tool | Description |
|------|-------------|
| `get_african_exchanges` | All 13 African exchanges with index levels and status |
| `get_african_exchange` | Detailed data for one exchange by ID |
| `get_african_exchange_stocks` | Stocks on any exchange with filtering and sorting |
| `get_african_exchange_movers` | Top gainers/losers on a specific exchange |
| `get_pan_african_movers` | Biggest movers across all African exchanges combined |
| `get_african_indices` | All African market indices with YTD performance |

---

## Example Prompts

Once connected, ask your AI assistant:

- *"What is the NGX All-Share Index today?"*
- *"Show me the top 5 gainers on the Ghana Stock Exchange"*
- *"What is the current price of DANGCEM?"*
- *"Compare today’s performance across all African exchanges"*
- *"What corporate disclosures has GTCo filed this week?"*
- *"Which African stock has the biggest gain today across all 13 exchanges?"*

---

## Supported Exchanges

| Exchange | Country | Coverage |
|----------|---------|----------|
| NGX | 🇳🇬 Nigeria | Full quote feed |
| GSE | 🇬🇭 Ghana | Full quote feed |
| NSE | 🇰🇪 Kenya | Full quote feed |
| JSE | 🇿🇦 South Africa | Full quote feed |
| BRVM | 🇨🇮 West Africa (8 countries) | Full quote feed |
| LuSE | 🇿🇲 Zambia | Full quote feed |
| EGX | 🇪🇬 Egypt | Benchmark index |
| CSE | 🇲🇦 Morocco | Benchmark index |
| BSE | 🇧🇼 Botswana | Benchmark index |
| SEM | 🇲🇺 Mauritius | Benchmark index |
| ZSE | 🇿🇼 Zimbabwe | Benchmark index |
| DSE | 🇹🇿 Tanzania | Benchmark index |
| USE | 🇺🇬 Uganda | Benchmark index |

---

## Installation

### Option 1 — Remote (recommended)

No installation. Add the remote URL to your MCP client:

```text
https://mcp.mansamarkets.com/mcp
```

### Option 2 — Self-hosted

```bash
git clone https://github.com/heyzod/mansa-african-markets-mcp.git
cd mansa-african-markets-mcp
npm install
npm start
```

---

## Client Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mansa-african-markets": {
      "type": "http",
      "url": "https://mcp.mansamarkets.com/mcp"
    }
  }
}
```

### Self-hosted

```json
{
  "mcpServers": {
    "mansa-african-markets": {
      "command": "node",
      "args": ["/absolute/path/to/mansa-african-markets-mcp/server.js"]
    }
  }
}
```

---

## Environment Variables

| Variable | Default | Description |
|---------------|------------|-----------------|
| `PORT` | `3000` | HTTP port |
| `NGX_API_KEY` | *(built-in)* | NGX Pulse API key |
| `MANSA_API_KEY` | *(built-in)* | Mansa API key |

---

## Rate Limiting

60 requests per minute per IP.

---

## Data Sources

- **NGX Pulse** — [ngxpulse.ng](https://ngxpulse.ng) — Nigerian Exchange market intelligence
- **Mansa Markets** — [mansamarkets.com](https://www.mansamarkets.com) — Pan-African capital markets terminal

---

## License

MIT
