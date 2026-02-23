#!/usr/bin/env node
/**
 * MCP server exposing Name.com CORE API domain-registrar & DNS tools.
 *
 * Tools:
 *   check_domain          – check availability + pricing
 *   search_domain         – keyword-based domain suggestions
 *   register_domain       – domain purchase (supports dryRun for confirmation)
 *   list_domains          – list all domains in the account
 *   get_domain            – get details for a single domain
 *   set_nameservers       – change nameservers for a domain
 *   manage_dns            – create / delete / list DNS records
 *   solve_dns01_challenge – automated ACME DNS-01 workflow
 *   update_ddns           – dynamic DNS A-record updater
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  clientFromEnv,
  getPublicIp,
  waitForTxtPropagation,
  NamecomApiError,
} from "./api.js";
import type { CreateRecordRequest } from "./api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatError(err: unknown): string {
  if (err instanceof NamecomApiError) {
    return JSON.stringify(err.toJSON(), null, 2);
  }
  return err instanceof Error ? err.message : String(err);
}

function ok(data: unknown): { content: { type: "text"; text: string }[] } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  return {
    content: [{ type: "text" as const, text: formatError(err) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "namecom-registrar",
  version: "0.0.1",
});

// ---- check_domain ---------------------------------------------------------

server.tool(
  "check_domain",
  `Check whether one or more domain names are available for registration via the Name.com CORE API.
Returns exact pricing in USD, renewal cost, and premium status for each domain.
Accepts up to 50 domains at once. Use this before register_domain.`,
  {
    domains: z
      .array(z.string())
      .min(1)
      .max(50)
      .describe("Fully-qualified domain names to check, e.g. [\"example.dev\", \"example.com\"]"),
  },
  async ({ domains }) => {
    try {
      const client = clientFromEnv();
      const res = await client.checkAvailability(domains);
      return ok(res.results);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---- search_domain --------------------------------------------------------

server.tool(
  "search_domain",
  `Search for available domain names by keyword. Returns suggestions across multiple TLDs
with pricing, renewal cost, and premium status. Use this when the user wants to brainstorm
or find a domain name but doesn't have exact names in mind yet. Optionally filter by TLDs.`,
  {
    keyword: z.string().describe("A keyword or phrase to base suggestions on, e.g. \"acmecorp\""),
    tldFilter: z
      .array(z.string())
      .max(50)
      .optional()
      .describe("Optional list of TLDs to restrict results, e.g. [\"dev\", \"com\", \"app\"]"),
  },
  async ({ keyword, tldFilter }) => {
    try {
      const client = clientFromEnv();
      const res = await client.search(keyword, tldFilter);
      return ok(res.results);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---- register_domain ------------------------------------------------------

server.tool(
  "register_domain",
  `Purchase and register a domain name through Name.com.
Charges the account's default payment profile. Automatically enables WHOIS privacy and registrar lock.
Recommended: call with dryRun: true first, show the user the quote, get explicit confirmation, then call with dryRun: false to complete.
For premium domains, you MUST first call check_domain to obtain the purchasePrice and purchaseType, then pass them here.`,
  {
    domainName: z.string().describe("The domain to register, e.g. \"mysite.dev\""),
    years: z.number().int().min(1).max(10).default(1).describe("Registration period in years (default 1)"),
    purchasePrice: z
      .number()
      .optional()
      .describe("Required for premium domains — the exact price from check_domain"),
    purchaseType: z
      .string()
      .optional()
      .describe("Required for premium domains — the purchaseType from check_domain"),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, do not charge; return a purchase quote and instruct to call again with dryRun: false after user confirmation"),
  },
  async ({ domainName, years, purchasePrice, purchaseType, dryRun }) => {
    try {
      const client = clientFromEnv();

      if (dryRun) {
        const avail = await client.checkAvailability([domainName]);
        const result = avail.results?.[0];
        if (!result) {
          return ok({
            dryRun: true,
            message: "Could not get pricing for this domain.",
            domainName,
          });
        }
        if (!result.purchasable) {
          return ok({
            dryRun: true,
            message: "Domain is not available for purchase.",
            domainName,
            reason: result.reason ?? "Not purchasable",
          });
        }
        const estimatedPrice = result.purchasePrice ?? result.renewalPrice ?? null;
        return ok({
          dryRun: true,
          message: "No charge made. Show this quote to the user. After explicit user confirmation, call register_domain again with the same parameters and dryRun: false to complete the purchase.",
          domainName,
          years,
          purchasePrice: result.purchasePrice,
          renewalPrice: result.renewalPrice,
          purchaseType: result.purchaseType,
          estimatedChargeUsd: estimatedPrice != null ? (estimatedPrice * years).toFixed(2) : null,
          premium: result.premium ?? false,
        });
      }

      const createRes = await client.createDomain({
        domain: { domainName },
        years,
        purchasePrice,
        purchaseType,
      });

      // Ensure privacy + lock are on (the API may default these, but be explicit)
      try {
        await client.updateDomain(domainName, {
          privacyEnabled: true,
          locked: true,
        });
      } catch {
        // Non-fatal: some TLDs don't support privacy
      }

      return ok({
        message: `Successfully registered ${domainName} for ${years} year(s).`,
        domain: createRes.domain,
        order: createRes.order,
        totalPaid: createRes.totalPaid,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

// ---- list_domains ---------------------------------------------------------

server.tool(
  "list_domains",
  `List all domains in the Name.com account. Returns domain name, expiration date,
autorenew status, lock status, and privacy status for each domain.
Use this to see what domains the user already owns.`,
  {},
  async () => {
    try {
      const client = clientFromEnv();
      const domains = await client.listDomains();
      return ok(domains);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---- get_domain -----------------------------------------------------------

server.tool(
  "get_domain",
  `Get detailed information about a single domain in the Name.com account, including
contacts, nameservers, expiration date, lock and privacy status, and renewal pricing.`,
  {
    domainName: z.string().describe("The domain to look up, e.g. \"example.com\""),
  },
  async ({ domainName }) => {
    try {
      const client = clientFromEnv();
      const domain = await client.getDomain(domainName);
      return ok(domain);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---- set_nameservers ------------------------------------------------------

server.tool(
  "set_nameservers",
  `Change the nameservers for a domain. Useful for pointing a domain to Cloudflare,
AWS Route 53, Fly.io DNS, or any other DNS provider. Replaces all existing nameservers.`,
  {
    domainName: z.string().describe("The domain to update, e.g. \"example.com\""),
    nameservers: z
      .array(z.string())
      .min(1)
      .max(12)
      .describe("List of nameserver hostnames, e.g. [\"ns1.cloudflare.com\", \"ns2.cloudflare.com\"]"),
  },
  async ({ domainName, nameservers }) => {
    try {
      const client = clientFromEnv();
      await client.setNameservers(domainName, nameservers);
      return ok({
        message: `Nameservers for ${domainName} updated to: ${nameservers.join(", ")}`,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

// ---- manage_dns -----------------------------------------------------------

const RECORD_TYPE_SCHEMA = z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "ANAME", "NS", "SRV"]);

server.tool(
  "manage_dns",
  `Create or delete DNS records for a domain managed at Name.com.
Supports A, AAAA, CNAME, MX, TXT, ANAME, NS, and SRV record types.
Use host="" or host="@" for apex records. Minimum TTL is 300.
For MX/SRV records, priority is required.
To list existing records, call with action="list".
To delete a record, you need its numeric ID — call action="list" first if you don't have it.`,
  {
    domainName: z.string().describe("The domain to manage, e.g. \"example.com\""),
    action: z.enum(["create", "delete", "list"]).describe("The operation to perform"),
    host: z.string().optional().describe("Record hostname (e.g. \"www\", \"*\", \"\" for apex). Required for create."),
    type: RECORD_TYPE_SCHEMA.optional().describe("DNS record type. Required for create."),
    answer: z.string().optional().describe("Record value (IP address, hostname, text). Required for create."),
    ttl: z.number().int().min(300).default(300).describe("Time-to-live in seconds (min 300)"),
    priority: z.number().int().optional().describe("Priority for MX and SRV records"),
    recordId: z.number().int().optional().describe("Numeric record ID, required for delete"),
  },
  async ({ domainName, action, host, type, answer, ttl, priority, recordId }) => {
    try {
      const client = clientFromEnv();

      if (action === "list") {
        const records = await client.listRecords(domainName);
        return ok(records);
      }

      if (action === "create") {
        if (host === undefined || !type || !answer) {
          return fail("host, type, and answer are required for creating a record.");
        }
        const req: CreateRecordRequest = { host, type, answer, ttl };
        if (priority !== undefined) req.priority = priority;
        const record = await client.createRecord(domainName, req);
        return ok({ message: `Created ${type} record for ${domainName}`, record });
      }

      if (action === "delete") {
        if (recordId === undefined) {
          return fail("recordId is required for deleting a record. Use action=\"list\" to find it.");
        }
        await client.deleteRecord(domainName, recordId);
        return ok({ message: `Deleted record ${recordId} from ${domainName}` });
      }

      return fail(`Unknown action: ${action}`);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---- solve_dns01_challenge ------------------------------------------------

server.tool(
  "solve_dns01_challenge",
  `Automated ACME DNS-01 challenge solver for TLS certificate issuance (e.g. Let's Encrypt).
Creates the _acme-challenge TXT record, polls Google and Cloudflare public DNS until the record
propagates globally (up to 2 minutes). Cleans up on timeout or error.
On success, returns the recordId — delete it via manage_dns after ACME validation completes.`,
  {
    domainName: z.string().describe("The base domain, e.g. \"example.com\""),
    host: z
      .string()
      .default("_acme-challenge")
      .describe("TXT record host. Defaults to \"_acme-challenge\". For wildcards use \"_acme-challenge\" (same host)."),
    challengeValue: z.string().describe("The ACME challenge digest string provided by the CA"),
    timeoutSeconds: z.number().int().min(30).max(600).default(120).describe("Max seconds to wait for propagation"),
  },
  async ({ domainName, host, challengeValue, timeoutSeconds }) => {
    const client = clientFromEnv();
    let recordId: number | undefined;

    try {
      // 1. Create TXT record
      const record = await client.createRecord(domainName, {
        host,
        type: "TXT",
        answer: challengeValue,
        ttl: 300,
      });
      recordId = record.id;

      const fqdn = host ? `${host}.${domainName}` : domainName;

      // 2. Poll for global propagation
      const propagated = await waitForTxtPropagation(
        fqdn,
        challengeValue,
        timeoutSeconds * 1000,
      );

      if (!propagated) {
        // Clean up even on timeout
        await client.deleteRecord(domainName, recordId).catch(() => {});
        return fail(
          `TXT record created but did not propagate within ${timeoutSeconds}s. ` +
            `Record ${recordId} has been cleaned up. Retry or increase timeout.`,
        );
      }

      return ok({
        message: `DNS-01 challenge ready. TXT record propagated globally.`,
        fqdn,
        recordId,
        note: "Proceed with ACME validation now. After validation, delete this record via manage_dns with the recordId above.",
      });
    } catch (err) {
      // Best-effort cleanup on error
      if (recordId !== undefined) {
        await client.deleteRecord(domainName, recordId).catch(() => {});
      }
      return fail(err);
    }
  },
);

// ---- update_ddns ----------------------------------------------------------

server.tool(
  "update_ddns",
  `Dynamic DNS updater. Detects this machine's current public IPv4 address and updates
(or creates) an A record at Name.com so a hostname always resolves to the current IP.
Useful for residential connections, home labs, self-hosted services like Home Assistant,
or any scenario where the public IP changes frequently.`,
  {
    domainName: z.string().describe("The domain containing the record, e.g. \"example.com\""),
    host: z.string().default("@").describe("The hostname to update (e.g. \"home\", \"vpn\", \"@\" for apex)"),
    ip: z.string().optional().describe("Override IP address. If omitted, auto-detects the current public IP."),
  },
  async ({ domainName, host, ip }) => {
    try {
      const client = clientFromEnv();
      const targetIp = ip ?? await getPublicIp();

      // Find existing A record for this host
      const records = await client.listRecords(domainName);
      const existing = records.find(
        (r) => r.type === "A" && r.host === (host === "@" ? "" : host),
      );

      if (existing) {
        if (existing.answer === targetIp) {
          return ok({
            message: `A record for ${host}.${domainName} already points to ${targetIp}. No update needed.`,
            record: existing,
          });
        }
        const updated = await client.updateRecord(domainName, existing.id, {
          host: existing.host,
          type: "A",
          answer: targetIp,
          ttl: 300,
        });
        return ok({
          message: `Updated A record for ${host}.${domainName}: ${existing.answer} → ${targetIp}`,
          record: updated,
        });
      }

      // No existing record — create one
      const created = await client.createRecord(domainName, {
        host: host === "@" ? "" : host,
        type: "A",
        answer: targetIp,
        ttl: 300,
      });
      return ok({
        message: `Created new A record for ${host}.${domainName} → ${targetIp}`,
        record: created,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
