import React from "react";
import { Link } from "react-router-dom";

export type EntityType = "person" | "grant" | "program" | "finance" | "payroll" | "module";

interface EntityLinkProps {
  type: EntityType;
  id?: string;
  to?: string;
  label: string;
  className?: string;
}

function pathFor(type: EntityType, id?: string, to?: string): string {
  if (to) return to;
  switch (type) {
    case "person": return id ? `/hq/people?id=${id}` : "/hq/people";
    case "grant": return id ? `/hq/grants?award=${id}` : "/hq/grants";
    case "program": return "/hq/programs";
    case "finance": return id ? `/hq/finance` : "/hq/finance";
    case "payroll": return "/hq/payroll";
    default: return "/hq";
  }
}

export const EntityLink: React.FC<EntityLinkProps> = ({ type, id, to, label, className = "" }) => (
  <Link to={pathFor(type, id, to)} className={`hq-entity-link ${className}`}>
    {label}
  </Link>
);
