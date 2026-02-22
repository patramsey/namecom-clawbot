/**
 * Strongly-typed wrapper around the Name.com CORE API (v1).
 * Docs: https://docs.name.com/api/v1/overview
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NamecomConfig {
  username: string;
  token: string;
  /** Defaults to production: https://api.name.com/core/v1 */
  baseUrl?: string;
}

export interface NamecomError {
  status: number;
  message: string;
  details: string | null;
}

// -- Domain availability ----------------------------------------------------

export interface AvailabilityResult {
  domainName: string;
  sld: string;
  tld: string;
  purchasable: boolean;
  purchasePrice?: number;
  renewalPrice?: number;
  purchaseType?: string;
  premium?: boolean;
  reason?: string;
}

export interface SearchResponse {
  results: AvailabilityResult[];
}

// -- Domain registration ----------------------------------------------------

export interface Contact {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  state?: string;
  zip: string;
  country: string;
  email: string;
  phone: string;
  fax?: string;
  organization?: string;
}

export interface DomainContacts {
  registrant?: Contact;
  admin?: Contact;
  tech?: Contact;
  billing?: Contact;
}

export interface Domain {
  domainName: string;
  createDate?: string;
  expireDate?: string;
  autorenewEnabled?: boolean;
  locked?: boolean;
  privacyEnabled?: boolean;
  contacts?: DomainContacts;
  nameservers?: string[];
  renewalPrice?: number;
}

export interface ListDomainsResponse {
  domains: Domain[];
  totalCount: number;
  from: number;
  to: number;
}

export interface CreateDomainRequest {
  domain: {
    domainName: string;
    contacts?: DomainContacts;
  };
  years?: number;
  purchasePrice?: number;
  purchaseType?: string;
  tldRequirements?: Record<string, string>;
  promoCode?: string;
}

export interface CreateDomainResponse {
  domain: Domain;
  order: number;
  totalPaid: number;
}

// -- DNS records ------------------------------------------------------------

export type RecordType = "A" | "AAAA" | "ANAME" | "CNAME" | "MX" | "NS" | "SRV" | "TXT";

export interface DnsRecord {
  id: number;
  domainName: string;
  host: string;
  fqdn: string;
  type: RecordType;
  answer: string;
  ttl: number;
  priority?: number;
}

export interface CreateRecordRequest {
  host: string;
  type: RecordType;
  answer: string;
  ttl?: number;
  priority?: number;
}

export interface UpdateRecordRequest {
  host: string;
  type: RecordType;
  answer: string;
  ttl?: number;
  priority?: number;
}

export interface ListRecordsResponse {
  records: DnsRecord[];
  totalCount: number;
  from: number;
  to: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const PRODUCTION_BASE = "https://api.name.com/core/v1";
const SANDBOX_BASE = "https://api.dev.name.com/core/v1";

export class NamecomApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiMessage: string,
    public readonly details: string | null,
  ) {
    super(`Name.com API ${status}: ${apiMessage}${details ? ` — ${details}` : ""}`);
    this.name = "NamecomApiError";
  }

  toJSON(): NamecomError {
    return { status: this.status, message: this.apiMessage, details: this.details };
  }
}

export class NamecomClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: NamecomConfig) {
    this.baseUrl = (config.baseUrl ?? PRODUCTION_BASE).replace(/\/+$/, "");
    this.authHeader =
      "Basic " + Buffer.from(`${config.username}:${config.token}`).toString("base64");
  }

  // -- Low-level fetch ------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return undefined as T;

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    if (!res.ok) {
      const msg = (json?.message as string) ?? res.statusText;
      const det = (json?.details as string) ?? null;
      throw new NamecomApiError(res.status, msg, det);
    }

    return json as T;
  }

  // -- Domain availability --------------------------------------------------

  async checkAvailability(domainNames: string[]): Promise<SearchResponse> {
    return this.request<SearchResponse>("POST", "/domains:checkAvailability", {
      domainNames,
    });
  }

  async search(keyword: string, tldFilter?: string[]): Promise<SearchResponse> {
    const body: Record<string, unknown> = { keyword };
    if (tldFilter?.length) body.tldFilter = tldFilter;
    return this.request<SearchResponse>("POST", "/domains:search", body);
  }

  // -- Domain management ----------------------------------------------------

  async listDomains(): Promise<Domain[]> {
    const res = await this.request<ListDomainsResponse>("GET", "/domains");
    return res.domains ?? [];
  }

  async createDomain(req: CreateDomainRequest): Promise<CreateDomainResponse> {
    return this.request<CreateDomainResponse>("POST", "/domains", req);
  }

  async getDomain(domainName: string): Promise<Domain> {
    return this.request<Domain>("GET", `/domains/${encodeURIComponent(domainName)}`);
  }

  async updateDomain(
    domainName: string,
    updates: Partial<Pick<Domain, "autorenewEnabled" | "locked" | "privacyEnabled">>,
  ): Promise<Domain> {
    return this.request<Domain>(
      "PUT",
      `/domains/${encodeURIComponent(domainName)}`,
      updates,
    );
  }

  async setNameservers(domainName: string, nameservers: string[]): Promise<void> {
    await this.request<void>(
      "POST",
      `/domains/${encodeURIComponent(domainName)}:setNameservers`,
      { nameservers },
    );
  }

  // -- DNS records ----------------------------------------------------------

  async listRecords(domainName: string): Promise<DnsRecord[]> {
    const res = await this.request<ListRecordsResponse>(
      "GET",
      `/domains/${encodeURIComponent(domainName)}/records`,
    );
    return res.records ?? [];
  }

  async getRecord(domainName: string, recordId: number): Promise<DnsRecord> {
    return this.request<DnsRecord>(
      "GET",
      `/domains/${encodeURIComponent(domainName)}/records/${recordId}`,
    );
  }

  async createRecord(domainName: string, record: CreateRecordRequest): Promise<DnsRecord> {
    return this.request<DnsRecord>(
      "POST",
      `/domains/${encodeURIComponent(domainName)}/records`,
      record,
    );
  }

  async updateRecord(
    domainName: string,
    recordId: number,
    record: UpdateRecordRequest,
  ): Promise<DnsRecord> {
    return this.request<DnsRecord>(
      "PUT",
      `/domains/${encodeURIComponent(domainName)}/records/${recordId}`,
      record,
    );
  }

  async deleteRecord(domainName: string, recordId: number): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/domains/${encodeURIComponent(domainName)}/records/${recordId}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a NamecomClient from environment variables.
 * Checks NAMECOM_USERNAME / NAMECOM_TOKEN first (production),
 * then NAMECOM_USERNAME_TEST / NAMECOM_TOKEN_TEST (sandbox).
 */
export function clientFromEnv(): NamecomClient {
  const username = process.env.NAMECOM_USERNAME ?? process.env.NAMECOM_USERNAME_TEST;
  const token = process.env.NAMECOM_TOKEN ?? process.env.NAMECOM_TOKEN_TEST;

  if (!username || !token) {
    throw new Error(
      "Missing Name.com credentials. Set NAMECOM_USERNAME + NAMECOM_TOKEN " +
        "(production) or NAMECOM_USERNAME_TEST + NAMECOM_TOKEN_TEST (sandbox).",
    );
  }

  const isSandbox = !process.env.NAMECOM_USERNAME;
  return new NamecomClient({
    username,
    token,
    baseUrl: isSandbox ? SANDBOX_BASE : PRODUCTION_BASE,
  });
}

/**
 * Fetch this machine's public IPv4 address.
 */
export async function getPublicIp(): Promise<string> {
  const res = await fetch("https://api.ipify.org?format=json");
  if (!res.ok) throw new Error(`Failed to detect public IP: ${res.statusText}`);
  const data = (await res.json()) as { ip: string };
  return data.ip;
}

/**
 * Resolve TXT records for an FQDN using Google Public DNS over HTTPS.
 * Returns the raw TXT strings, or an empty array if none exist.
 */
export async function resolveTxtOverDoh(fqdn: string): Promise<string[]> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(fqdn)}&type=TXT`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    Answer?: { type: number; data: string }[];
  };
  return (data.Answer ?? [])
    .filter((a) => a.type === 16)
    .map((a) => a.data.replace(/^"|"$/g, ""));
}

/**
 * Poll until a TXT record with the expected value is globally visible, or
 * until `timeoutMs` elapses. Uses DNS-over-HTTPS against Google and
 * Cloudflare resolvers.
 */
export async function waitForTxtPropagation(
  fqdn: string,
  expectedValue: string,
  timeoutMs = 120_000,
  intervalMs = 5_000,
): Promise<boolean> {
  const cfResolve = async (): Promise<string[]> => {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(fqdn)}&type=TXT`;
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      Answer?: { type: number; data: string }[];
    };
    return (data.Answer ?? [])
      .filter((a) => a.type === 16)
      .map((a) => a.data.replace(/^"|"$/g, ""));
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [google, cf] = await Promise.all([
      resolveTxtOverDoh(fqdn),
      cfResolve(),
    ]);
    if (google.includes(expectedValue) && cf.includes(expectedValue)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
