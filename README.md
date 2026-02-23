# namecom-clawbot

MCP server that gives an AI agent autonomous control over domain registration and DNS management through the [Name.com CORE API](https://docs.name.com/api/v1/overview).

Works with new purchases **and** domains you already own at Name.com. Ships with an [AgentSkills](https://agentskills.io/)-compatible `SKILL.md` and is published on [ClawHub](https://clawhub.ai/patramsey/namecom-registrar) for one-command install into OpenClaw.

> **v0.0.1** — early release. The nine core tools are functional but the API surface may change.

## Prerequisites

1. **A name.com account** — [name.com/account/signup](https://www.name.com/account/signup)
2. **An API token** — generate one at **Account > Security > API Access**
3. **Account funding** — domain purchases are charged to your name.com account balance or default payment method. Prefer **Name.com account credit** over attaching a credit card to cap potential loss if the API token is misused. Use `register_domain` with **`dryRun: true`** first to get a quote, then with `dryRun: false` after user confirmation to complete the purchase.

For sandbox testing, create credentials at [dev.name.com](https://dev.name.com) instead.

## Setup

```bash
git clone <this-repo>
cd namecom-clawbot
npm install
npm run build
```

### Environment variables

| Variable | Description |
|---|---|
| `NAMECOM_USERNAME` | Your name.com username (production) |
| `NAMECOM_TOKEN` | Your name.com API token (production) |
| `NAMECOM_USERNAME_TEST` | Sandbox username — your username with `-test` appended |
| `NAMECOM_TOKEN_TEST` | Sandbox API token |

Set either the production pair or the sandbox pair. Production takes precedence if both are present.

### MCP host configuration

Add to your Cursor / Claude Desktop / OpenClaw MCP config:

```json
{
  "mcpServers": {
    "namecom-registrar": {
      "command": "node",
      "args": ["/absolute/path/to/namecom-clawbot/dist/src/index.js"],
      "env": {
        "NAMECOM_USERNAME": "your-username",
        "NAMECOM_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `check_domain` | Check availability and pricing for up to 50 specific domains |
| `search_domain` | Keyword-based domain suggestions with pricing across multiple TLDs |
| `register_domain` | Purchase a domain (use `dryRun: true` then `dryRun: false` for confirmation); enables WHOIS privacy and registrar lock |
| `list_domains` | List all domains in the account with status and expiration |
| `get_domain` | Get full details for a single domain (contacts, nameservers, pricing) |
| `set_nameservers` | Point a domain to a different DNS provider (Cloudflare, Route 53, etc.) |
| `manage_dns` | Create, delete, or list DNS records (A, AAAA, CNAME, MX, TXT, and more) |
| `solve_dns01_challenge` | Automated ACME DNS-01 challenge: creates TXT record, polls for propagation, cleans up |
| `update_ddns` | Dynamic DNS — detects public IP and updates/creates an A record to match |

## Managing existing domains

Every tool works on domains already in your name.com account — not just newly registered ones. Use `manage_dns` to list, create, or delete records on any domain you own, or `update_ddns` to keep a hostname pointed at a changing IP.

## Example prompts

- *"Find me a cheap .dev domain for my new project called acmecorp."*
- *"Check if acmecorp.dev is available and how much it costs."*
- *"Buy acmecorp.dev and point it at 123.45.67.89 with a wildcard A record."*
- *"What domains do I own? Show me the details for mydomain.com."*
- *"Point mydomain.com at Cloudflare's nameservers."*
- *"List all DNS records for mydomain.com."*
- *"Add an MX record for mydomain.com pointing to mail.protonmail.ch with priority 10."*
- *"My IP changed — update the DDNS record for home.mydomain.com."*
- *"Solve this DNS-01 challenge for mydomain.com: `abc123digestvalue`"*

## Important notes

- **Purchases are real.** In production mode, `register_domain` (with `dryRun: false`) will charge your account. Use the confirmation flow: call with `dryRun: true`, show the quote, get user confirmation, then call with `dryRun: false`. Use sandbox credentials while testing.
- **Fund your account first.** Prefer Name.com account credit over a credit card to limit exposure. Ensure your account has a valid payment method or sufficient credit before purchasing.
- **Rate limits.** The name.com API allows 20 requests/second and 3,000 requests/hour.

## SOUL.md

The `SOUL.md` file defines the agent's persona and operational constraints when using these tools — execution safety, security posture, communication style, and stack defaults. MCP hosts that support it (e.g. OpenClaw) will load it automatically.

## License

MIT
