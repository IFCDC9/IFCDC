/**
 * Lightweight global bus so any HQ page/button can open the AURA command bar
 * (and optionally prefill/auto-run a command with module context) without
 * threading a provider through the whole app.
 */

export const AURA_OPEN_EVENT = "aura:open";

export interface AuraOpenDetail {
  prefill?: string;
  module?: string;
  contextRef?: Record<string, unknown>;
  /** When true, immediately run the prefilled command. */
  autoRun?: boolean;
  /** When set, directly invoke a registered action instead of a free-form command. */
  actionId?: string;
  args?: Record<string, unknown>;
}

export function openAura(detail: AuraOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent<AuraOpenDetail>(AURA_OPEN_EVENT, { detail }));
}
