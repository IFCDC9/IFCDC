import type { ElementType } from "react";
import { Home, Shield, GraduationCap, Megaphone, HandHeart, TrendingUp } from "lucide-react";

export type ProgramSlug =
  | "housing"
  | "anti-gang"
  | "scholarships"
  | "outreach"
  | "mentorship"
  | "economic-development";

export interface ProgramModuleDef {
  slug: ProgramSlug;
  title: string;
  description: string;
  icon: ElementType;
  opsPath?: string;
  relatedPaths: { label: string; path: string }[];
}

export const PROGRAM_MODULES: ProgramModuleDef[] = [
  {
    slug: "housing",
    title: "Transitional Housing",
    description: "Units, applications, placements, and case management.",
    icon: Home,
    opsPath: "/hq/housing",
    relatedPaths: [{ label: "Housing Operations", path: "/hq/housing" }, { label: "People Center", path: "/hq/people" }, { label: "Financial Center", path: "/hq/finance" }],
  },
  {
    slug: "anti-gang",
    title: "Anti-Gang Program",
    description: "Youth intervention, violence prevention, and outcome tracking.",
    icon: Shield,
    opsPath: "/logic-model",
    relatedPaths: [{ label: "Logic Model", path: "/logic-model" }, { label: "Compliance Center", path: "/hq/compliance" }, { label: "People Center", path: "/hq/people" }],
  },
  {
    slug: "scholarships",
    title: "Scholarship Program",
    description: "Scholarship opportunities, applications, and awards.",
    icon: GraduationCap,
    opsPath: "/hq/scholarships",
    relatedPaths: [{ label: "Scholarship Operations", path: "/hq/scholarships" }, { label: "Grant Center", path: "/hq/grants" }, { label: "Financial Center", path: "/hq/finance" }],
  },
  {
    slug: "outreach",
    title: "Community Outreach",
    description: "Events, resource fairs, and neighborhood engagement.",
    icon: Megaphone,
    relatedPaths: [{ label: "Organization Calendar", path: "/hq/calendar" }, { label: "Communications", path: "/hq/communications" }],
  },
  {
    slug: "mentorship",
    title: "Youth Mentorship",
    description: "Mentor pairs, sessions, and youth development metrics.",
    icon: HandHeart,
    relatedPaths: [{ label: "Mentors in People Center", path: "/hq/people?type=mentor" }, { label: "Calendar", path: "/hq/calendar" }],
  },
  {
    slug: "economic-development",
    title: "Economic Development",
    description: "Job training, workforce placement, and business support.",
    icon: TrendingUp,
    relatedPaths: [{ label: "Financial Center", path: "/hq/finance" }, { label: "Grant Center", path: "/hq/grants" }],
  },
];

export function getProgramDef(slug: string): ProgramModuleDef | undefined {
  return PROGRAM_MODULES.find((p) => p.slug === slug);
}

export function programModulePath(slug: ProgramSlug): string {
  return `/hq/programs/${slug}`;
}
