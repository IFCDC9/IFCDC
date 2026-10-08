/**
 * Server-side Microsoft Graph Mail.Read connector for the IFCDC business mailbox.
 * It polls only when called. It does not start a timer, send mail, or change mailbox state.
 * App registration must grant Mail.Read only. This module does not request a send permission.
 */
import type { Request, Response } from "express";
import { htmlToPlainText } from "./emailBrand";
import {
  inboundMailSessionStatus,
  ingestInboundBusinessMail,
  type MailDb,
} from "./inboundBusinessMail";

export const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

export type MailboxPollStatus = "ok" | "not_configured" | "failed" | "never";

export type GraphMailboxHealth = {
  microsoftGraphConfigured: boolean;
  inboundMailboxConfigured: boolean;
  graphReadReady: boolean;
  lastSuccessfulMailboxPoll: string | null;
  lastMailboxPollStatus: MailboxPollStatus;
};

export type MailboxPollResult = {
  status: Exclude<MailboxPollStatus, "never">;
  retrieved: number;
  created: number;
  alreadyStored: number;
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
};

let lastSuccessfulMailboxPoll: string | null = null;
let lastMailboxPollStatus: MailboxPollStatus = "never";

export function resetGraphMailboxPollStateForTests(): void {
  lastSuccessfulMailboxPoll = null;
  lastMailboxPollStatus = "never";
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

function inboxMessagesUrl(mailbox: string, top: number): string {
  const select = "id,conversationId,subject,from,toRecipients,receivedDateTime,body,hasAttachments";
  const expand = "attachments($select=name,contentType,size)";
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$select=${select}&$orderby=receivedDateTime desc&$expand=${expand}&$top=${top}`;
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
  return { status: "not_configured", retrieved: 0, created: 0, alreadyStored: 0 };
}

function failed(): MailboxPollResult {
  lastMailboxPollStatus = "failed";
  return { status: "failed", retrieved: 0, created: 0, alreadyStored: 0 };
}

function boundedPollTop(value: number | undefined): number {
  const requested = Number.isFinite(value) ? Math.floor(value as number) : 5;
  return Math.min(5, Math.max(1, requested));
}

export async function pollMicrosoftGraphMailbox(options: {
  db: MailDb;
  fetchImpl?: typeof fetch;
  env?: GraphEnv;
  top?: number;
} ): Promise<MailboxPollResult> {
  const env = options.env ?? process.env;
  const config = readGraphMailboxConfig(env);
  if (!config.microsoftGraphConfigured || !config.inboundMailboxConfigured) {
    return notConfigured();
  }

  const top = boundedPollTop(options.top);
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
    if (!tokenResponse.ok) return failed();
    const tokenPayload = await tokenResponse.json() as { access_token?: string };
    const accessToken = tokenPayload.access_token;
    if (!accessToken) return failed();

    const messagesResponse = await fetchImpl(inboxMessagesUrl(config.mailbox, top), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!messagesResponse.ok) return failed();
    const payload = await messagesResponse.json() as { value?: GraphMessage[] };
    if (!Array.isArray(payload.value)) return failed();

    let created = 0;
    let alreadyStored = 0;
    let retrieved = 0;
    for (const message of payload.value.slice(0, top)) {
      const providerMessageId = (message.id || "").trim();
      if (!providerMessageId) continue;
      retrieved += 1;
      const stored = await ingestInboundBusinessMail(options.db, {
        providerMessageId,
        threadId: message.conversationId ?? null,
        senderName: message.from?.emailAddress?.name ?? null,
        senderAddress: message.from?.emailAddress?.address || "unknown@invalid",
        recipient: recipientList(message, config.mailbox),
        subject: message.subject || "(no subject)",
        textBody: messageText(message.body),
        receivedAt: message.receivedDateTime || new Date().toISOString(),
        attachments: attachmentMetadata(message),
      });
      if (stored.created) created += 1;
      else alreadyStored += 1;
    }

    lastSuccessfulMailboxPoll = new Date().toISOString();
    lastMailboxPollStatus = "ok";
    return { status: "ok", retrieved, created, alreadyStored };
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
    duplicatesCreated: 0,
  });
}
