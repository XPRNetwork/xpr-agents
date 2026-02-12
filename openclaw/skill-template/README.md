# XPR Agent Skill Template

Copy this directory to create a new skill module for XPR agents.

## Quick Start

```bash
# Copy the template
cp -r openclaw/skill-template my-skill
cd my-skill

# Customize
# 1. Edit package.json — set name, description, author
# 2. Edit skill.json — set name, tools, capabilities, requirements
# 3. Edit SKILL.md — write behavioral instructions for the AI
# 4. Edit src/index.ts — implement your tools

# Install and build
npm install
npm run build

# Test locally
# In your agent .env, add:
#   AGENT_SKILLS=./path/to/my-skill
```

## File Structure

| File | Purpose |
|------|---------|
| `package.json` | npm metadata, `xprSkill: true` marker |
| `skill.json` | Skill manifest (metadata, capabilities, requirements) |
| `SKILL.md` | Behavioral instructions appended to the agent's system prompt |
| `src/index.ts` | Entry point — default export registers tools via `SkillApi` |
| `tsconfig.json` | TypeScript configuration |

## Publishing

```bash
# Build
npm run build

# Publish to npm
npm publish --access public
```

Then any agent operator can install and enable your skill:

```bash
npm install @your-org/skill-my-skill
# In .env:
AGENT_SKILLS=@your-org/skill-my-skill
```

## Documentation

See [docs/SKILLS.md](../../docs/SKILLS.md) for the full skill module guide.
