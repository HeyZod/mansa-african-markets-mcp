# ChatGPT App Directory Submission Brief

This file is a submission prep document for the existing live MCP server.

It does not change runtime behavior.

## Live App Identity

- App name: `Mansa African Markets`
- MCP URL: `https://mcp.mansamarkets.com/mcp`
- Health URL: `https://mcp.mansamarkets.com/health`
- Website: `https://www.mansamarkets.com`
- Repository: `https://github.com/HeyZod/mansa-african-markets-mcp`

## Positioning

Mansa African Markets gives ChatGPT live African stock market data across 13 exchanges, with especially strong Nigerian market coverage through NGX Pulse and NASD data.

Primary differentiator:
- Pan-African public market coverage is still thin in most AI app directories.
- Mansa covers `13 exchanges` and `772+ stocks`.
- NGX Pulse gives strong Nigerian market depth: market overview, prices, top gainers, top losers, disclosures, and NASD OTC data.

## What Is Already Ready

- Public HTTPS remote MCP endpoint exists.
- Transport is `streamable-http`.
- Health endpoint exists.
- Repo metadata exists in `server.json`.
- The server is read-oriented market data, which is a clean fit for ChatGPT app usage.
- Public website exists with product pages and company pages.
- Public policy and contact links appear on the website footer:
  - `https://www.mansamarkets.com/privacy`
  - `https://www.mansamarkets.com/terms`
  - `https://www.mansamarkets.com/contact`

## Likely Submission Blockers

### 1. Tool safety annotations

OpenAI's app directory submission guidance says `readOnlyHint`, `destructiveHint`, and `openWorldHint` are required for all tools.

Current repo status:
- Added in this branch to all 14 tools in `server.js`

Chosen values:
- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: false`
- `idempotentHint: true`

Reason:
- The current tools fetch and return market data only.
- They do not create, update, delete, send, publish, or mutate third-party state.

Source:
- https://help.openai.com/en/articles/20001040-submitting-apps-to-the-chatgpt-app-directory

### 2. OpenAI account verification

You must submit from a verified OpenAI platform account.

Source:
- https://help.openai.com/en/articles/20001040-submitting-apps-to-the-chatgpt-app-directory

### 3. Test cases must pass in ChatGPT web and mobile

OpenAI explicitly checks test-case reliability and says apps may be rejected if the provided test cases do not produce correct results on web and mobile.

Source:
- https://help.openai.com/en/articles/20001040-submitting-apps-to-the-chatgpt-app-directory

## Recommended Listing Copy

### App title

`Mansa African Markets`

### Short description

`Live African stock market data across 13 exchanges, including NGX, NASD, GSE, NSE, JSE, and BRVM.`

### Longer description

`Mansa African Markets gives ChatGPT live African market data in real time. Query 13 exchanges and 772+ stocks, including deep Nigerian market coverage powered by NGX Pulse. Get NGX market overview, stock prices, top gainers and losers, disclosures, NASD OTC data, pan-African movers, exchange-level stock lists, and major African indices.`

### Why this app is distinct

- `Pan-African coverage`: NGX, GSE, NSE, JSE, BRVM, LuSE, DSE, EGX, CSE, BSE, SEM, ZSE, USE
- `Nigeria depth`: NGX overview, prices, movers, disclosures, NASD OTC
- `Live market intelligence`: exchange summaries, movers, indices, and listed stock screens

## Suggested Category and Tags

- Suggested category: `Finance`
- Suggested keywords:
  - `african stocks`
  - `nigerian stocks`
  - `ngx`
  - `nasd`
  - `jse`
  - `gse`
  - `market data`
  - `indices`
  - `top gainers`
  - `disclosures`

## Submission Test Cases

These are practical test cases to include in the submission flow.

### Test 1

Prompt:
`What is the latest NGX market overview?`

Expected behavior:
- Calls `get_ngx_market_overview`
- Returns ASI, market cap, volume or value, and advancers/decliners
- Includes attribution to NGX Pulse

### Test 2

Prompt:
`What are the top gainers on the NGX today?`

Expected behavior:
- Calls `get_ngx_top_gainers`
- Returns ranked gainers with symbol, price, percent change, and volume
- Includes attribution to NGX Pulse

### Test 3

Prompt:
`Give me the latest NASD OTC stocks in Nigeria.`

Expected behavior:
- Calls `get_nasd_stocks`
- Returns NASD securities data
- Includes attribution to NGX Pulse

### Test 4

Prompt:
`What are the top movers across African exchanges today?`

Expected behavior:
- Calls `get_pan_african_movers`
- Returns cross-market gainers and losers
- Includes attribution to Mansa Markets

### Test 5

Prompt:
`Show me the latest data for the Ghana exchange.`

Expected behavior:
- Calls `get_african_exchange` with `ghana`
- Returns exchange summary and current market context
- Includes attribution to Mansa Markets

### Test 6

Prompt:
`List the latest corporate disclosures from NGX companies.`

Expected behavior:
- Calls `get_ngx_disclosures`
- Returns recent filings or notices
- Includes attribution to NGX Pulse

## Submission Flow

1. Verify your OpenAI platform account.
2. Build or package the app through the OpenAI Apps flow.
3. Use the live MCP URL: `https://mcp.mansamarkets.com/mcp`
4. Fill in listing metadata using the copy above.
5. Add privacy policy, terms, and support/contact URLs.
6. Add the test cases above.
7. Submit for review.
8. If approved, publish from the OpenAI platform so it appears in the ChatGPT app directory.

Sources:
- https://help.openai.com/en/articles/11487775-apps-in-chatgpt
- https://help.openai.com/en/articles/20001040-submitting-apps-to-the-chatgpt-app-directory
- https://platform.openai.com/docs/guides/developer-mode
