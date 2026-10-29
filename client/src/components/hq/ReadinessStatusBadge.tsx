import React from "react";
import { StatusBadge } from "./StatusBadge";

/** Adapt readiness API status values to the shared badge's label/variant contract. */
export function ReadinessStatusBadge({ status }: { status: string }) {
  const label = status === "pending_manual" ? "UNVERIFIED" : status.replace(/_/g, " ").toUpperCase();
  const variant = ["fail", "blocked", "critical", "high"].includes(status) ? "danger"
    : ["warn", "pending_manual", "not_certified", "medium"].includes(status) ? "warning"
    : ["pass", "certified", "resolved"].includes(status) ? "success" : "muted";
  return <StatusBadge label={label} variant={variant} />;
}
