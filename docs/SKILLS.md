# XPR Agent Skill Modules

Skill modules are portable, reusable packages that extend an agent's capabilities with new tools and behavioral instructions.

## Overview

- **Skill authors** create npm packages with tools, metadata, and AI instructions
- **Agent operators** install skills via npm and enable them with `AGENT_SKILLS` env var
- **Skills are discoverable** via A2A agent cards — capabilities from loaded skills appear in `/.well-known/agent.json`
- **Zero learning curve** — skills use the same `registerTool()` API as OpenClaw core tools

## Package Structure

```
@xpr-agents/skill-<name>/
  package.json          # npm metadata, "xprSkill": true marker
  skill.json            # Skill manifest (metadata, capabilities, requirements)
  SKILL.md              # Behavioral instructions (appended to system prompt)
  src/index.ts          # Default export: function(api) that registers tools
  dist/index.js         # Compiled entry
  tsconfig.json         # TypeScript config
```

### skill.json — Manifest

```json
{
  "name": "web-scraping",
  "version": "1.0.0",
  "description": "Web scraping and data extraction tools",
  "author": "your-name",
  "category": "compute",
  "tags": ["web", "scraping", "extraction"],
  "capabilities": ["web-scraping", "data-extraction"],
  "tools": ["scrape_url", "extract_data"],
  "requires": {
    "env": ["SCRAPER_API_KEY"]
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique skill identifier |
| `version` | Yes | Semver version string |
| `description` | Yes | Human-readable description |
| `author` | Yes | npm org or XPR account name |
| `category` | Yes | One of: compute, storage, oracle, payment, messaging, ai |
| `tags` | No | Search/filter tags (defaults to `[]`) |
| `capabilities` | No | A2A card skill entries (defaults to `[]`) |
| `tools` | Yes | Tool names this skill registers |
| `requires.env` | No | Required environment variables (warns if missing) |
| `pricing` | No | Future: on-chain marketplace pricing |

### SKILL.md — Behavioral Instructions

The SKILL.md content is appended to the agent's system prompt as a `## Skill: <name>` section. YAML frontmatter is stripped automatically.

```markdown
---
name: web-scraping
description: Web scraping and data extraction
---
## Web Scraping

When asked to extract data from websites:
1. Use `scrape_url` to fetch and parse HTML
2. Use `extract_data` for structured extraction
3. Always respect robots.txt and rate limits
```

Limit: 10KB maximum. Larger files are truncated.

### src/index.ts — Tool Registration

The entry point must default-export a function that receives a `SkillApi` and registers tools:

```typescript
import type { SkillApi } from '@xpr-agents/openclaw';

export default function mySkill(api: SkillApi): void {
  api.registerTool({
    name: 'scrape_url',
    description: 'Fetch and parse HTML from a URL',
    parameters: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'URL to scrape' },
      },
    },
    handler: async ({ url }) => {
      const resp = await fetch(url);
      const html = await resp.text();
      return { html, status: resp.status };
    },
  });
}
```

The `SkillApi` interface:
- `registerTool(tool)` — register a tool (same interface as OpenClaw core tools)
- `getConfig()` — get runtime config (network, rpcEndpoint, indexerUrl)

## Creating a Skill

### Step 1: Copy the Template

```bash
cp -r openclaw/skill-template my-skill
cd my-skill
```

### Step 2: Customize Metadata

Edit `package.json`:
```json
{
  "name": "@your-org/skill-my-skill",
  "version": "1.0.0",
  "description": "My custom agent skill",
  "xprSkill": true
}
```

Edit `skill.json` with your skill's metadata, capabilities, and tool names.

### Step 3: Write Behavioral Instructions

Edit `SKILL.md` with clear instructions for the AI on when and how to use your tools.

### Step 4: Implement Tools

Edit `src/index.ts` — register your tools using `api.registerTool()`.

### Step 5: Build

```bash
npm install
npm run build
```

## Testing Locally

Set `AGENT_SKILLS` to a local path in your agent's `.env`:

```bash
AGENT_SKILLS=./path/to/my-skill
```

Start the agent runner — you should see:
```
[skill] Loaded "my-skill" v1.0.0: 2 tools
```

Verify:
- Tools appear in `/health` endpoint (check tool count)
- Capabilities appear in `/.well-known/agent.json` skills array
- SKILL.md content is in the system prompt (test with a manual `/run` prompt)

## Publishing to npm

```bash
npm run build
npm publish --access public
```

Then any agent operator can install and enable:

```bash
npm install @your-org/skill-my-skill
# In .env:
AGENT_SKILLS=@your-org/skill-my-skill
```

Multiple skills can be comma-separated:
```bash
AGENT_SKILLS=@your-org/skill-web-scraping,@your-org/skill-pdf-tools,./local-skill
```

## How the Loader Works

1. **Discovery** — Reads `AGENT_SKILLS` env var, splits by comma
2. **Resolution** — Local paths resolved via `path.resolve()`, npm packages via `require.resolve()`
3. **Validation** — Loads and validates `skill.json` manifest (required fields check)
4. **Requirements** — Checks `requires.env` vars (warns if missing, still loads)
5. **SKILL.md** — Reads and strips frontmatter, enforces 10KB limit
6. **Loading** — Requires entry point (`dist/index.js` or `src/index.ts`), calls with `SkillApi`
7. **Collision detection** — If a skill tool name conflicts with a core tool, the skill tool is skipped (core always wins)
8. **Registration** — Tools added to the agent's tool array, prompt sections appended, capabilities merged

Built-in skills (like `creative`) are loaded separately via `loadBuiltinSkill()` and are always available regardless of `AGENT_SKILLS`.

## Tool Name Collisions

Core OpenClaw tools always take priority. If a skill tries to register a tool with the same name as an existing tool:
- The skill tool is **skipped** (not registered)
- A warning is logged: `[skill] "my-skill" tried to register tool "xpr_get_agent" which already exists — skipped`
- Other tools from the skill are still registered

Between skills, first-loaded wins (order matches `AGENT_SKILLS` list order).

## Security Considerations

- Skills run **in-process** with the agent runner — they have full access to the Node.js runtime
- Only install skills from trusted sources (verified npm packages or your own code)
- Skills can access environment variables, make network requests, and read the filesystem
- The `requires.env` field is informational only — it does not restrict access
- Review skill source code before deploying to production

## Future: On-Chain Skill Exchange

The existing `agentcore` plugins table maps cleanly to `skill.json`:

| skill.json | plugins table |
|---|---|
| name | name |
| version | version |
| category | category |
| author | author |
| description+tags | schema (JSON) |

A future `skillmarket` contract could enable:
- Pricing (XPR per skill purchase)
- Purchase tracking (which agents bought which skills)
- Revenue distribution (authors earn from sales)
- License verification at load time
- Autonomous skill acquisition — agent discovers a job it can't handle, browses the skill market, purchases and loads a skill, then completes the job
