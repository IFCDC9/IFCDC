/**
 * Server-side Microsoft Graph Mail.Read connector for the IFCDC business mailbox.
 * Recurring sync starts only from startMicrosoftGraphMailboxSync in production.
 * Importing this module does not poll. The connector does not send mail or change mailbox state.
 * App registration must grant Mail.Read only. This module does not request a send permission.
 */
import type { Request, Response } from "express";
import { htmlToPlainText } from "./emailBrand";
import {
  classifyInboundMail,
  ensureInboundBusinessMailTables,
  inboundMailSessionStatus,
  ingestInboundBusinessMail,
  type InboundMailInput,
  type MailDb,
  type StoredInboundMail,
} from "./inboundBusinessMail";

export const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

export type MailboxPollStatus = "ok" | "not_configured" | "failed" | "never";

export const MAILBOX_SYNC_INTERVAL_MS = 5 * 60 * 1000;
export const MAILBOX_SYNC_CYCLE_LIMIT = 25;

export type GraphMailboxHealth = {
  microsoftGraphConfigured: boolean;
  inboundMailboxConfigured: boolean;
  graphReadReady: boolean;
  lastSuccessfulMailboxPoll: string | null;
  lastMailboxPollStatus: MailboxPollStatus;
  automaticPolling: boolean;
  mailboxSyncIntervalMs: number;
};

export type MailboxPollResult = {
  status: Exclude<MailboxPollStatus, "never">;
  retrieved: number;
  created: number;
  alreadyStored: number;
  updated: number;
};

type GraphEnv = {
  MICROSOFT_GRAPH_TENANT_ID?: string;
  MICROSOFT_GRAPH_CLIENT_ID?: string;
  MICROSOFT_GRAPH_CLIENT_SECRET?: string;
  INBOUND_MAILBOX_ADDRESS?: string;
};

type GraphEmailAddress = { name?: string; address?: string };
type GraphAttachment = { name?: string; contentType?: string; size?: number };
type GraphMessage = {
  id?: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: GraphEmailAddress };
  toRecipients?: Array<{ emailAddress?: GraphEmailAddress }>;
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  attachments?: GraphAttachment[];
  "@removed"?: unknown;
};

type GraphPage = {
  value?: GraphMessage[];
  "@odata.deltaLink"?: unknown;
  "@odata.nextLink"?: unknown;
};

let lastSuccessfulMailboxPoll: string | null = null;
let lastMailboxPollStatus: MailboxPollStatus = "never";
let mailboxSyncTimer: ReturnType<typeof setInterval> | null = null;
let syncInFlight = false;

export function resetGraphMailboxPollStateForTests(): void {
  lastSuccessfulMailboxPoll = null;
  lastMailboxPollStatus = "never";
  syncInFlight = false;
  if (mailboxSyncTimer) clearInterval(mailboxSyncTimer);
  mailboxSyncTimer = null;
}

export function mailboxSyncScheduled(): boolean {
  return mailboxSyncTimer != null;
}

function trimmed(value: string | undefined): string {
  return (value || "").trim();
}

export function readGraphMailboxConfig(env: GraphEnv = process.env) {
  const tenantId = trimmed(env.MICROSOFT_GRAPH_TENANT_ID);
  const clientId = trimmed(env.MICROSOFT_GRAPH_CLIENT_ID);
  const clientSecret = trimmed(env.MICROSOFT_GRAPH_CLIENT_SECRET);
  const mailbox = trimmed(env.INBOUND_MAILBOX_ADDRESS);
  const microsoftGraphConfigured = Boolean(tenantId && clientId && clientSecret);
  const inboundMailboxConfigured = mailbox.length > 0 && mailbox.includes("@") && !mailbox.includes(" ");
  return {
    microsoftGraphConfigured,
    inboundMailboxConfigured,
    tenantId,
    clientId,
    clientSecret,
    mailbox,
  };
}

export function graphMailboxHealth(env: GraphEnv = process.env): GraphMailboxHealth {
  const config = readGraphMailboxConfig(env);
  return {
    microsoftGraphConfigured: config.microsoftGraphConfigured,
    inboundMailboxConfigured: config.inboundMailboxConfigured,
    graphReadReady: config.microsoftGraphConfigured && config.inboundMailboxConfigured,
    lastSuccessfulMailboxPoll,
    lastMailboxPollStatus,
    automaticPolling: mailboxSyncScheduled(),
    mailboxSyncIntervalMs: MAILBOX_SYNC_INTERVAL_MS,
  };
}

export async function graphMailboxHealthHttp(req: Request, res: Response, env: GraphEnv = process.env): Promise<void> {
  const status = inboundMailSessionStatus(req.hqUser);
  if (status) {
    res.status(status).json({ error: status === 401 ? "Authentication required" : "Founder session required" });
    return;
  }
  res.json(graphMailboxHealth(env));
}

export type GraphAuthReadiness = {
  graphAuthenticationReady: boolean;
  mailReadAuthorityAvailable: boolean;
  httpStatus: number;
  errorCode: string | null;
  mailSendPresent: boolean;
};

function notConfiguredReadiness(): GraphAuthReadiness {
  return {
    graphAuthenticationReady: false,
    mailReadAuthorityAvailable: false,
    httpStatus: 0,
    errorCode: "not_configured",
    mailSendPresent: false,
  };
}

function failedReadiness(httpStatus: number, errorCode: string | null): GraphAuthReadiness {
  return {
    graphAuthenticationReady: false,
    mailReadAuthorityAvailable: false,
    httpStatus,
    errorCode,
    mailSendPresent: false,
  };
}

function safeOAuthErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^[A-Za-z0-9_]{1,64}$/.test(value)) return null;
  return value;
}

function rolesFromAccessToken(token: string): string[] {
  const payload = token.split(".")[1];
  if (!payload) return [];
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { roles?: unknown };
    if (!Array.isArray(json.roles)) return [];
    return json.roles.filter((role): role is string => typeof role === "string");
  } catch {
    return [];
  }
}

export async function checkGraphAuthenticationReadiness(options: {
  fetchImpl?: typeof fetch;
  env?: GraphEnv;
} = {}): Promise<GraphAuthReadiness> {
  const config = readGraphMailboxConfig(options.env ?? process.env);
  if (!config.microsoftGraphConfigured) return notConfiguredReadiness();

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const tokenBody = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: GRAPH_SCOPE,
      grant_type: "client_credentials",
    });
    const tokenResponse = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      },
    );
    if (!tokenResponse.ok) {
      let errorCode = "token_request_failed";
      try {
        const failure = await tokenResponse.json() as { error?: unknown };
        errorCode = safeOAuthErrorCode(failure.error) ?? "token_request_failed";
      } catch {
        errorCode = "token_request_failed";
      }
      return failedReadiness(tokenResponse.status, errorCode);
    }
    const tokenPayload = await tokenResponse.json() as { access_token?: unknown };
    const accessToken = typeof tokenPayload.access_token === "string" ? tokenPayload.access_token : "";
    if (!accessToken) return failedReadiness(tokenResponse.status, "token_request_failed");
    const roles = rolesFromAccessToken(accessToken);
    const mailReadAuthorityAvailable = roles.includes("Mail.Read");
    const mailSendPresent = roles.includes("Mail.Send");
    return {
      graphAuthenticationReady: true,
      mailReadAuthorityAvailable,
      httpStatus: tokenResponse.status,
      errorCode: null,
      mailSendPresent,
    };
  } catch {
    return failedReadiness(0, "token_request_failed");
  }
}

export async function graphAuthReadinessHttp(
  req: Request,
  res: Response,
  options: { env?: GraphEnv; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const status = inboundMailSessionStatus(req.hqUser);
  if (status) {
    res.status(status).json({ error: status === 401 ? "Authentication required" : "Founder session required" });
    return;
  }
  res.json(await checkGraphAuthenticationReadiness(options));
}

const MESSAGE_SELECT = "id,conversationId,subject,from,toRecipients,receivedDateTime,body,hasAttachments";

function inboxMessagesUrl(mailbox: string, top: number, receivedAfter?: string | null): string {
  const expand = "attachments($select=name,contentType,size)";
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$select=${MESSAGE_SELECT}&$orderby=receivedDateTime desc&$expand=${expand}&$top=${top}`;
  if (receivedAfter && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(receivedAfter)) {
    url += `&$filter=${encodeURIComponent(`receivedDateTime gt ${receivedAfter}`)}`;
  }
  return url;
}

function latestDeltaUrl(mailbox: string): string {
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages/delta?$deltatoken=latest&$select=${MESSAGE_SELECT}&$top=${MAILBOX_SYNC_CYCLE_LIMIT}`;
}

function safeInboxReadUrl(value: string, mailbox: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com") return null;
    const path = decodeURIComponent(url.pathname);
    const list = `/v1.0/users/${mailbox}/mailFolders/inbox/messages`;
    if (path !== list && path !== `${list}/delta`) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function messageText(body: GraphMessage["body"]): string {
  const content = body?.content ?? "";
  if ((body?.contentType || "").toLowerCase() === "text") return content;
  return htmlToPlainText(content);
}

function attachmentMetadata(message: GraphMessage): Array<Record<string, unknown>> {
  return (message.attachments ?? []).map((item) => ({
    filename: item.name || "attachment",
    contentType: item.contentType || "application/octet-stream",
    size: Number(item.size) || 0,
  }));
}

function recipientList(message: GraphMessage, mailbox: string): string {
  const addresses = (message.toRecipients ?? [])
    .map((item) => (item.emailAddress?.address || "").trim())
    .filter(Boolean);
  return addresses.length ? addresses.join(", ") : mailbox;
}

function notConfigured(): MailboxPollResult {
  lastMailboxPollStatus = "not_configured";
  return { status: "not_configured", retrieved: 0, created: 0, alreadyStored: 0, updated: 0 };
}

function failed(): MailboxPollResult {
  lastMailboxPollStatus = "failed";
  return { status: "failed", retrieved: 0, created: 0, alreadyStored: 0, updated: 0 };
}

function boundedTop(value: number | undefined, fallback: number, max: number): number {
  const requested = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.min(max, Math.max(1, requested));
}

function boundedPollTop(value: number | undefined): number {
  return boundedTop(value, 5, 5);
}

function boundedCycleTop(value: number | undefined): number {
  return boundedTop(value, MAILBOX_SYNC_CYCLE_LIMIT, MAILBOX_SYNC_CYCLE_LIMIT);
}

async function ensureGraphSyncTable(db: MailDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_graph_mailbox_sync (
      mailbox TEXT PRIMARY KEY,
      delta_link TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

async function newestStoredReceivedAt(db: MailDb): Promise<string | null> {
  await ensureInboundBusinessMailTables(db);
  const row = await db.get<{ received_at?: string | null }>(
    "SELECT received_at FROM hq_inbound_business_mail ORDER BY received_at DESC LIMIT 1",
  );
  return row?.received_at || null;
}

async function loadDeltaLink(db: MailDb, mailbox: string): Promise<string | null> {
  await ensureGraphSyncTable(db);
  const row = await db.get<{ delta_link?: string | null }>(
    "SELECT delta_link FROM hq_graph_mailbox_sync WHERE mailbox = ?",
    mailbox,
  );
  const link = row?.delta_link || "";
  return link ? safeInboxReadUrl(link, mailbox) : null;
}

async function saveDeltaLink(db: MailDb, mailbox: string, link: string): Promise<void> {
  const safe = safeInboxReadUrl(link, mailbox);
  if (!safe) return;
  await ensureGraphSyncTable(db);
  await db.run(
    `INSERT INTO hq_graph_mailbox_sync (mailbox, delta_link, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(mailbox) DO UPDATE SET delta_link = excluded.delta_link, updated_at = excluded.updated_at`,
    mailbox,
    safe,
    new Date().toISOString(),
  );
}

function messageInput(message: GraphMessage, mailbox: string): InboundMailInput | null {
  const providerMessageId = (message.id || "").trim();
  if (!providerMessageId || message["@removed"]) return null;
  return {
    providerMessageId,
    threadId: message.conversationId ?? null,
    senderName: message.from?.emailAddress?.name ?? null,
    senderAddress: message.from?.emailAddress?.address || "unknown@invalid",
    recipient: recipientList(message, mailbox),
    subject: message.subject || "(no subject)",
    textBody: messageText(message.body),
    receivedAt: message.receivedDateTime || new Date().toISOString(),
    attachments: attachmentMetadata(message),
  };
}

async function updateStoredClassification(db: MailDb, existing: StoredInboundMail, input: InboundMailInput): Promise<boolean> {
  const classified = classifyInboundMail({
    subject: input.subject,
    textBody: input.textBody,
    senderAddress: input.senderAddress,
  });
  const same = existing.subject === input.subject
    && existing.textBody === input.textBody
    && existing.category === classified.category
    && existing.unmatched === classified.unmatched
    && existing.urgency === classified.urgency
    && existing.founderAttention === classified.founderAttention
    && existing.flags.deadline === classified.flags.deadline
    && existing.deadline === classified.deadline
    && existing.flags.meeting === classified.flags.meeting
    && existing.flags.fundingOpportunity === classified.flags.fundingOpportunity
    && existing.flags.payment === classified.flags.payment
    && existing.flags.approval === classified.flags.approval
    && existing.flags.partnershipRequest === classified.flags.partnershipRequest
    && existing.awaitingReply === classified.awaitingReply
    && existing.followUp === classified.followUp;
  if (same) return false;
  await db.run(
    `UPDATE hq_inbound_business_mail SET
      subject = ?, text_body = ?,
      category = ?, category_unmatched = ?, urgency = ?, founder_attention = ?,
      flag_deadline = ?, deadline_on = ?, flag_meeting = ?, flag_funding_opportunity = ?,
      flag_payment = ?, flag_approval = ?, flag_partnership = ?,
      awaiting_reply = ?, follow_up = ?
     WHERE provider_message_id = ?`,
    input.subject,
    input.textBody,
    classified.category,
    classified.unmatched ? 1 : 0,
    classified.urgency,
    classified.founderAttention ? 1 : 0,
    classified.flags.deadline ? 1 : 0,
    classified.deadline,
    classified.flags.meeting ? 1 : 0,
    classified.flags.fundingOpportunity ? 1 : 0,
    classified.flags.payment ? 1 : 0,
    classified.flags.approval ? 1 : 0,
    classified.flags.partnershipRequest ? 1 : 0,
    classified.awaitingReply ? 1 : 0,
    classified.followUp ? 1 : 0,
    input.providerMessageId,
  );
  return true;
}

async function storeGraphMessages(
  db: MailDb,
  mailbox: string,
  messages: GraphMessage[],
  limit: number,
): Promise<Pick<MailboxPollResult, "retrieved" | "created" | "alreadyStored" | "updated">> {
  let retrieved = 0;
  let created = 0;
  let alreadyStored = 0;
  let updated = 0;
  for (const message of messages.slice(0, limit)) {
    const input = messageInput(message, mailbox);
    if (!input) continue;
    retrieved += 1;
    const stored = await ingestInboundBusinessMail(db, input);
    if (stored.created) {
      created += 1;
      continue;
    }
    if (await updateStoredClassification(db, stored.row, input)) updated += 1;
    else alreadyStored += 1;
  }
  return { retrieved, created, alreadyStored, updated };
}

function addCounts(
  left: Pick<MailboxPollResult, "retrieved" | "created" | "alreadyStored" | "updated">,
  right: Pick<MailboxPollResult, "retrieved" | "created" | "alreadyStored" | "updated">,
): Pick<MailboxPollResult, "retrieved" | "created" | "alreadyStored" | "updated"> {
  return {
    retrieved: left.retrieved + right.retrieved,
    created: left.created + right.created,
    alreadyStored: left.alreadyStored + right.alreadyStored,
    updated: left.updated + right.updated,
  };
}

async function graphGet(fetchImpl: typeof fetch, url: string, accessToken: string): Promise<GraphPage | null> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) return null;
  const payload = await response.json() as GraphPage;
  if (!Array.isArray(payload.value)) return null;
  return payload;
}

async function readDeltaChanges(
  db: MailDb,
  fetchImpl: typeof fetch,
  mailbox: string,
  accessToken: string,
  limit: number,
): Promise<Pick<MailboxPollResult, "retrieved" | "created" | "alreadyStored" | "updated">> {
  const empty = { retrieved: 0, created: 0, alreadyStored: 0, updated: 0 };
  if (limit <= 0) return empty;
  const storedLink = await loadDeltaLink(db, mailbox);
  const url = storedLink ?? latestDeltaUrl(mailbox);
  const payload = await graphGet(fetchImpl, url, accessToken);
  if (!payload) return empty;
  const next = typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : "";
  const delta = typeof payload["@odata.deltaLink"] === "string" ? payload["@odata.deltaLink"] : "";
  const follow = next || delta;
  if (follow) await saveDeltaLink(db, mailbox, follow);
  return storeGraphMessages(db, mailbox, payload.value ?? [], limit);
}

export async function pollMicrosoftGraphMailbox(options: {
  db: MailDb;
  fetchImpl?: typeof fetch;
  env?: GraphEnv;
  top?: number;
  incremental?: boolean;
} ): Promise<MailboxPollResult> {
  const env = options.env ?? process.env;
  const config = readGraphMailboxConfig(env);
  if (!config.microsoftGraphConfigured || !config.inboundMailboxConfigured) {
    return notConfigured();
  }

  const incremental = options.incremental === true;
  const top = incremental ? boundedCycleTop(options.top) : boundedPollTop(options.top);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const receivedAfter = incremental ? await newestStoredReceivedAt(options.db) : null;
    const tokenBody = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: GRAPH_SCOPE,
      grant_type: "client_credentials",
    });
    const tokenResponse = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      },
    );
    if (!tokenResponse.ok) return failed();
    const tokenPayload = await tokenResponse.json() as { access_token?: string };
    const accessToken = tokenPayload.access_token;
    if (!accessToken) return failed();

    const page = await graphGet(fetchImpl, inboxMessagesUrl(config.mailbox, top, receivedAfter), accessToken);
    if (!page) return failed();
    let counts = await storeGraphMessages(options.db, config.mailbox, page.value ?? [], top);
    if (incremental) {
      counts = addCounts(counts, await readDeltaChanges(
        options.db,
        fetchImpl,
        config.mailbox,
        accessToken,
        top - counts.retrieved,
      ));
    }

    lastSuccessfulMailboxPoll = new Date().toISOString();
    lastMailboxPollStatus = "ok";
    return { status: "ok", ...counts };
  } catch {
    return failed();
  }
}

export async function graphMailboxPollOnceHttp(
  req: Request,
  res: Response,
  options: { db?: MailDb; fetchImpl?: typeof fetch; env?: GraphEnv } = {},
): Promise<void> {
  const status = inboundMailSessionStatus(req.hqUser);
  if (status) {
    res.status(status).json({ error: status === 401 ? "Authentication required" : "Founder session required" });
    return;
  }
  const db = options.db ?? await (await import("../db")).getDb();
  const result = await pollMicrosoftGraphMailbox({
    db,
    fetchImpl: options.fetchImpl,
    env: options.env,
    top: 5,
  });
  res.json({
    status: result.status,
    retrieved: result.retrieved,
    stored: result.created,
    alreadyStored: result.alreadyStored,
    updated: result.updated,
    duplicatesCreated: 0,
  });
}

export async function graphMailboxSyncOnceHttp(
  req: Request,
  res: Response,
  options: { db?: MailDb; fetchImpl?: typeof fetch; env?: GraphEnv } = {},
): Promise<void> {
  const status = inboundMailSessionStatus(req.hqUser);
  if (status) {
    res.status(status).json({ error: status === 401 ? "Authentication required" : "Founder session required" });
    return;
  }
  const db = options.db ?? await (await import("../db")).getDb();
  const result = await pollMicrosoftGraphMailbox({
    db,
    fetchImpl: options.fetchImpl,
    env: options.env,
    top: MAILBOX_SYNC_CYCLE_LIMIT,
    incremental: true,
  });
  res.json({
    status: result.status,
    retrieved: result.retrieved,
    stored: result.created,
    alreadyStored: result.alreadyStored,
    updated: result.updated,
    duplicatesCreated: 0,
    incremental: true,
  });
}

async function runScheduledMailboxSync(): Promise<void> {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    const { getDb } = await import("../db");
    await pollMicrosoftGraphMailbox({
      db: await getDb(),
      top: MAILBOX_SYNC_CYCLE_LIMIT,
      incremental: true,
    });
  } catch {
    lastMailboxPollStatus = "failed";
    console.error("Graph mailbox sync failed");
  } finally {
    syncInFlight = false;
  }
}

export function startMicrosoftGraphMailboxSync(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (mailboxSyncTimer) return;
  mailboxSyncTimer = setInterval(runScheduledMailboxSync, MAILBOX_SYNC_INTERVAL_MS);
  mailboxSyncTimer.unref?.();
}
