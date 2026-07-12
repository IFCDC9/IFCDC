import React from "react";
import {
  Sparkles,
  PenLine,
  FileText,
  Search,
  BarChart3,
  ShieldCheck,
  HelpCircle,
  Wrench,
  Radar,
} from "lucide-react";
import { openAura } from "./auraBus";

/** The contextual AURA actions available on module pages. */
export type AuraButtonId =
  | "ask"
  | "draft"
  | "summarize"
  | "find_funding"
  | "enterprise_scan"
  | "generate_report"
  | "prepare_approval"
  | "explain"
  | "fix_workflow";

interface ButtonSpec {
  id: AuraButtonId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Free-form command prefill (goes through the dispatcher). */
  prefill?: string;
  /** Or a direct registered action id. */
  actionId?: string;
  autoRun?: boolean;
}

const BUTTONS: Record<AuraButtonId, ButtonSpec> = {
  ask: { id: "ask", label: "Ask AURA", icon: Sparkles },
  draft: { id: "draft", label: "Draft with AURA", icon: PenLine, actionId: "draft_proposal", autoRun: false },
  summarize: { id: "summarize", label: "Summarize with AURA", icon: FileText, actionId: "summarize", autoRun: true },
  find_funding: { id: "find_funding", label: "Find Funding", icon: Search, actionId: "find_grants", autoRun: true },
  enterprise_scan: { id: "enterprise_scan", label: "Enterprise Scan", icon: Radar, actionId: "enterprise_funding_scan", autoRun: true },
  generate_report: { id: "generate_report", label: "Generate Report", icon: BarChart3, actionId: "generate_report", autoRun: true },
  prepare_approval: { id: "prepare_approval", label: "Prepare for Approval", icon: ShieldCheck, actionId: "prepare_for_approval", autoRun: true },
  explain: { id: "explain", label: "Explain This", icon: HelpCircle, actionId: "explain", autoRun: true },
  fix_workflow: { id: "fix_workflow", label: "Fix This Workflow", icon: Wrench, actionId: "fix_workflow", autoRun: true },
};

interface AuraActionButtonsProps {
  module: string;
  /** Which buttons to show (defaults to Ask + Summarize + Explain). */
  actions?: AuraButtonId[];
  /** Entity references passed to AURA (applicationId, workflowInstanceId, reportType, programSlug, etc.). */
  contextRef?: Record<string, unknown>;
  /** Optional per-action argument overrides passed when invoking a direct action. */
  actionArgs?: Partial<Record<AuraButtonId, Record<string, unknown>>>;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Reusable contextual AURA buttons. Each opens the AURA command bar and either
 * runs a direct registered action (with page context) or prefills a command.
 */
export function AuraActionButtons({
  module,
  actions = ["ask", "summarize", "explain"],
  contextRef,
  actionArgs,
  size = "sm",
  className,
}: AuraActionButtonsProps): React.ReactElement {
  const trigger = (spec: ButtonSpec) => {
    if (spec.id === "ask") {
      openAura({ module, contextRef });
      return;
    }
    if (spec.actionId) {
      openAura({
        module,
        contextRef,
        actionId: spec.actionId,
        args: actionArgs?.[spec.id],
        prefill: spec.label,
      });
      return;
    }
    openAura({ module, contextRef, prefill: spec.prefill, autoRun: spec.autoRun });
  };

  const resolved = (actions ?? [])
    .map((id) => BUTTONS[id as AuraButtonId])
    .filter((spec): spec is ButtonSpec => Boolean(spec?.icon));

  if (!resolved.length) {
    return (
      <div className={`hq-aura-actions ${className ?? ""}`}>
        <button
          type="button"
          className={`hq-aura-action-btn ${size === "sm" ? "sm" : ""}`}
          onClick={() => openAura({ module, contextRef })}
          title="Ask AURA"
        >
          <Sparkles size={14} />
          <span>Ask AURA</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`hq-aura-actions ${className ?? ""}`}>
      {resolved.map((spec) => {
        const Icon = spec.icon;
        return (
          <button
            key={spec.id}
            type="button"
            className={`hq-aura-action-btn ${size === "sm" ? "sm" : ""}`}
            onClick={() => trigger(spec)}
            title={spec.label}
          >
            <Icon size={14} />
            <span>{spec.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default AuraActionButtons;
