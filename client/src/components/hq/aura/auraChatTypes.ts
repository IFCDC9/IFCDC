import type { AuraExecutedAction } from "../../../api/hqApi";

export type AuraChatRole = "user" | "aura";

export interface AuraChatMessageModel {
  id: string;
  role: AuraChatRole;
  text: string;
  /** Full text when streaming or when Continue Generating unfolds more content. */
  fullText?: string;
  actions?: AuraExecutedAction[];
  navigation?: { path: string; label: string };
  approvals?: Array<{ path: string; label: string }>;
  error?: boolean;
  progress?: number;
  phase?: string;
  jobId?: string;
  jobStatus?: "queued" | "running" | "completed" | "failed" | string;
  streaming?: boolean;
  collapsed?: boolean;
  createdAt: string;
}

export function newMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const LONG_REPORT_COLLAPSE_CHARS = 1800;
export const CONTINUE_CHUNK_CHARS = 2200;

export function shouldCollapse(text: string): boolean {
  return text.length > LONG_REPORT_COLLAPSE_CHARS;
}
