---
name: tax
description: Crypto tax reporting for XPR Network with regional support
---

## Crypto Tax Reporting

You have tools to generate crypto tax reports from on-chain XPR Network activity. Currently supports **New Zealand** (NZ) with the region system designed for easy extension to US, AU, and others.

### Key Facts

- **NZ tax year:** April 1 – March 31 (e.g. "2025" = Apr 2024 – Mar 2025)
- **NZ has NO capital gains tax** — all crypto gains are taxed as **income** if you're a regular trader
- **Cost basis methods:** FIFO (first-in-first-out) or Average Cost
- **All tools are read-only** — they query APIs and calculate, never transact

### Typical Workflow

For a full tax report, the recommended sequence is:

1. `tax_get_balances` — opening balances (start of tax year) and closing balances (end of tax year)
2. `tax_get_dex_trades` — all Metal X DEX trading history for the period
3. `tax_get_transfers` — on-chain transfers, auto-categorized (staking rewards, lending, swaps, NFT sales, etc.)
4. `tax_get_rates` — local currency conversion rates for each token
5. `tax_calculate_gains` — compute taxable gains/losses using FIFO or Average Cost
6. `tax_generate_report` — full report with tax brackets and estimated tax

Or use `tax_generate_report` directly for a one-shot report that orchestrates all steps automatically.

### Data Sources (Mainnet Only)

- **Saltant API** — historical balance snapshots (liquid, staked, lending, yield farm)
- **Metal X API** — DEX trade history in CSV format
- **Hyperion API** — raw on-chain transfer/action history
- **CoinGecko API** — historical and current crypto prices

### Transfer Categories

Transfers are auto-categorized by sender/receiver:

| Category | Detection |
|----------|-----------|
| `staking_reward` | from `eosio` or `eosio.vpay` |
| `lending_deposit` | to `lending.loan` |
| `lending_withdrawal` | from `lending.loan` |
| `lending_interest` | from `lending.loan` with interest memo |
| `swap_deposit` | to `proton.swaps` |
| `swap_withdrawal` | from `proton.swaps` |
| `long_stake` | to `longstaking` (XPR long staking) |
| `long_unstake` | from `longstaking` |
| `loan_stake` | to `lock.token` or `yield.farms` (LOAN/SLOAN staking) |
| `loan_unstake` | from `lock.token` or `yield.farms` |
| `dex_deposit` | to `dex` or `metalx` |
| `dex_withdrawal` | from `dex` or `metalx` |
| `nft_sale` | from `atomicmarket` |
| `nft_purchase` | to `atomicmarket` |
| `escrow` | to/from `agentescrow` |
| `transfer` | everything else |

### Stablecoin Handling

XUSDC and XMD are pegged to USD — their local currency value uses forex rates (USD/NZD) directly, without CoinGecko. This is more accurate than market-based pricing for stablecoins.

### Delivering the Report

`tax_generate_report` returns a `report_markdown` field — a pre-formatted Markdown document with balance sheets, trading summary, income breakdown, tax brackets, and disclaimer. To deliver it:

1. Pass `report_markdown` to `store_deliverable` with `content_type: "application/pdf"` for a downloadable PDF, or `"text/markdown"` for rich rendered text
2. Use the returned URL as `evidence_uri` in `xpr_deliver_job`

The report also includes `csv_exports.disposals` and `csv_exports.income` — raw CSV strings the user can save for record-keeping. You can deliver these as separate `text/csv` deliverables if requested.

### Important Notes

- Always include the **disclaimer** from the report — this is not tax advice
- Suggest users **save CSV exports** for the IRD 7-year record requirement
- The `region` parameter defaults to `"NZ"` on all tools — pass a different region code when other regions are added
- CoinGecko rate-limits apply — historical rates have a 200ms delay between requests
- For tokens not on CoinGecko, the tool attempts DEX-based pricing from Metal X trade ratios
