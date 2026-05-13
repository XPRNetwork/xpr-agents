---
name: smart-contracts
description: XPR Network smart contract development — chain inspection, code scaffolding, and automated auditing
---

## Smart Contract Development

You have tools for **XPR Network smart contract development** using AssemblyScript (proton-tsc). You can inspect deployed contracts, scaffold new ones, and audit code for common pitfalls.

### CRITICAL Safety Rules

**Table Schema Immutability:**
- NEVER modify existing table structures once deployed with data
- Adding, removing, reordering, or renaming fields breaks binary deserialization
- Existing rows become unreadable ("unable to unpack" errors)
- Safe approach: create NEW tables for new features
- Data is never lost — rolling back the ABI restores access

**AssemblyScript Gotchas (proton-tsc compiles to WASM via AS):**
- `===` compares references, NOT string content — use `==` for strings
- Arrow functions in `.filter()/.map()/.reduce()` fail (no closures) — use `for` loops
- `try/catch` is not supported — use `check()` for validation
- `: any` type does not exist — all values must be typed
- `undefined` cannot be used as a value — use `null` or default values
- No union types (except nullable `T | null`)
- Objects must be typed classes, not `{}`

**Security Essentials:**
- Every public action MUST call `requireAuth(actor)` — missing auth = critical vuln
- Notify handlers MUST check `this.firstReceiver` — prevents spoofed token transfers
- Init actions MUST have re-init guards — prevents config overwrite
- Never use `check(false)` after inline token transfers — reverts the entire tx including the transfer
- Never use floating point for financial calculations — use `u64` with fixed decimals
- Never hardcode private keys in contract code
- Cross-contract table reads use positional binary serialization — field order must match exactly

### Contract Patterns

**Project Structure:**
```
mycontract/
├── assembly/
│   └── mycontract.contract.ts   # Must end in .contract.ts
├── package.json                  # build: npx proton-asc ./assembly/mycontract.contract.ts
└── tsconfig.json
```

**Key Imports:**
```typescript
import { Contract, Table, TableStore, Singleton, Name, Asset, Symbol,
         check, requireAuth, hasAuth, isAccount, currentTimeSec,
         InlineAction, PermissionLevel } from 'proton-tsc';
```

**Table Basics:**
- `@table("name")` decorator (1-12 chars, a-z1-5 only)
- `@primary` getter returns `u64` (primary key)
- `@secondary` getters for indexed lookups (use `.N` for Name fields)
- `@table("name", singleton)` for single-row config tables
- `TableStore<T>` for CRUD: `.store()`, `.set()`, `.get()`, `.update()`, `.remove()`, `.requireGet()`
- `Singleton<T>` for singletons: `.get()`, `.set()`, `.remove()`

**Action Patterns:**
- `@action("name")` decorator on contract methods
- `@action("transfer", notify)` for handling incoming transfers
- `this.receiver` = this contract account
- `this.firstReceiver` = originating contract (check in notify handlers!)
- `this.receiver` auth for admin-only actions

**Inline Actions (calling other contracts):**
```typescript
const transfer = new InlineAction<TransferArgs>("eosio.token", "transfer");
transfer.send(
  [new PermissionLevel(this.receiver, Name.fromString("active"))],
  new TransferArgs(this.receiver, recipient, amount, memo)
);
```
Requires `proton contract:enableinline CONTRACT` before use.

### CLI Equivalents

These tools replace `@proton/cli` commands for environments where the CLI isn't available (Docker, server-side):

| Tool | Replaces |
|------|----------|
| `sc_get_abi` | `proton contract:abi ACCOUNT` |
| `sc_read_table` | `proton table CODE TABLE [SCOPE]` |
| `sc_get_account_info` | `proton account ACCOUNT` |
| `sc_get_chain_info` | `proton chain:info` |
| `sc_get_action_history` | `proton transaction:get` / Hyperion queries |

### Tool Usage Guide

**Inspecting a deployed contract:**
1. `sc_get_abi` — see all tables and actions
2. `sc_get_table_schema` — extract field types for a specific table
3. `sc_read_table` — read actual data rows

**Scaffolding a new contract:**
1. `sc_scaffold_contract` — generates full project (contract.ts, package.json, tsconfig, test file)
2. Or use individual tools: `sc_scaffold_table`, `sc_scaffold_action`, `sc_scaffold_test`

**Auditing contract code:**
1. `sc_audit_contract` — scans for 17 known pitfalls (missing auth, AS gotchas, table issues)
2. Review findings by severity: critical > warning > info
3. Fix critical issues before deployment

**Before deployment (use chain inspection tools to verify):**
1. `sc_read_table` — check if tables have existing data (NEVER modify populated table schemas)
2. `sc_get_abi` — compare old vs new ABI for breaking changes
3. `sc_get_account_info` — verify target account has enough RAM

### Resources

**RPC Endpoints:**
- Mainnet: `https://proton.eosusa.io`
- Testnet: `https://proton-testnet.eosusa.io`

**Chain IDs:**
- Mainnet: `384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0`
- Testnet: `71ee83bcf52142d61019d95f9cc5427ba6a0d7ff8accd9e2088ae2abebd3e7df`

**Key Packages:**
- `proton-tsc` — AssemblyScript contract SDK (types, decorators, utilities)
- `proton-asc` — compiler (AssemblyScript → WASM + ABI)
- `@proton/vert` — local VM for unit testing contracts
- `@proton/js` — JavaScript SDK for RPC calls and transaction signing
- `@proton/cli` — CLI tool for deployment and chain interaction
