# Mansa African Markets MCP Server

Real-time African stock market data for AI assistants — powered by **NGX Pulse** and **Mansa Markets**.

**14 tools. 13 African exchanges. Live data.**

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
| `get_pan_african_movers` | Biggest movers across ALL African exchanges combined |
| `get_african_indices` | All African market indices with YTD performance |

## Supported Exchanges
NGX (Nigeria), GSE (Ghana), NSE (Kenya), JSE (South Africa), BRVM (West Africa), DSE (Tanzania), LuSE (Zambia), EGX (Egypt), CSE (Morocco), BSE (Botswana), SEM (Mauritius), ZSE (Zimbabwe), USE (Uganda)

## Installation

```bash
git clone https://github.com/heyzod/mansa-african-markets-mcp.git
cd mansa-african-markets-mcp
npm install
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `NGX_API_KEY` | *(built-in)* | NGX Pulse API key |
| `MANSA_API_KEY` | *(built-in)* | Mansa API key |

## Claude Desktop Integration

Add to `claude_desktop_config.json`:
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

## Remote MCP (Claude.ai, API)

Use as a remote MCP server:
```
https://mcp.mansamarkets.com/mcp
```

## Rate Limiting
60 requests per minute per IP.

## License
MIT
