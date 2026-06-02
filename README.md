# consentgate-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets any
MCP-capable agent (Claude Desktop, Claude Code, Cursor, custom agents, …) gate its own
actions behind a human's consent policy via [ConsentGate](https://consentgate.fyi).

The agent asks **before** it acts; you stay in control. High-stakes actions can block on an
explicit **Approve / Deny** tap delivered to your Telegram.

## Tools

| Tool | Blocks? | What it does |
|------|---------|--------------|
| `check_action` | no | Evaluates an action against your consent rules. Returns `allow`, `deny`, or `ask` (no rule matched). Use it before any sensitive/irreversible action. |
| `request_approval` | yes (≤120s) | Sends an Approve/Deny prompt to your Telegram and blocks until you tap or it times out. Returns `allow` only on an explicit human Approve; everything else (deny, timeout, not-available) is `deny`. |

Both **fail closed**: anything other than an explicit `allow` means *do not proceed*.

## Prerequisites

1. A ConsentGate account and an API key → **https://consentgate.fyi/dashboard/keys** (`cg_…`).
2. For `request_approval` (interactive approvals): the **Pro** plan **and** a linked Telegram
   account (Dashboard → Telegram → Connect). `check_action` works on any plan.

## Configuration

Environment variables:

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `CONSENTGATE_API_KEY` | ✅ | — | Your `cg_…` key. |
| `CONSENTGATE_BASE_URL` | — | `https://consentgate.fyi` | Override for self-hosted instances. |

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```jsonc
{
  "mcpServers": {
    "consentgate": {
      "command": "npx",
      "args": ["-y", "consentgate-mcp"],
      "env": { "CONSENTGATE_API_KEY": "cg_your_key_here" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add consentgate --env CONSENTGATE_API_KEY=cg_your_key_here -- npx -y consentgate-mcp
```

### Generic MCP client

Run `npx -y consentgate-mcp` (stdio transport) with `CONSENTGATE_API_KEY` in the environment.

## Run from source

> Until the package is published to npm, point your client at the built file
> (`node /abs/path/to/mcp/dist/index.js`) instead of `npx consentgate-mcp`.

```bash
cd mcp
npm install        # also builds via the `prepare` script
npm run build      # -> dist/index.js
CONSENTGATE_API_KEY=cg_… npm run smoke   # lists tools + a live check_action
```

## How an agent should use it

A good agent policy:

> Before performing any action that sends messages, spends money, deletes data, posts
> publicly, or changes external state, call `check_action`. If the result is `allow`,
> proceed. If `deny`, stop. If `ask` (or the action is high-stakes), call `request_approval`
> and proceed only on an explicit `allow`.

Example (`request_approval`):

```jsonc
{
  "action": "transfer_funds",
  "category": "spending",
  "metadata": { "amount": "$500", "to": "Acme Corp" },
  "wait_seconds": 90
}
// -> blocks; you tap Approve in Telegram -> { "decision": "allow", "resolved_by": "human" }
```

## License

MIT
