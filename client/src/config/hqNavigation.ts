import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Monitor,
  Users,
  Wallet,
  Landmark,
  FileText,
  Heart,
  Home,
  GraduationCap,
  Radio,
  BarChart3,
  Bell,
  Sparkles,
  Settings,
  FolderOpen,
  HandHeart,
  Package,
  Truck,
  Building,
  Shield,
  Calendar,
  Gavel,
  Megaphone,
  Briefcase,
  FileBarChart,
  Code2,
  GitBranch,
  LineChart,
  Plug,
  Brain,
} from "lucide-react";

export interface HQNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  section: string;
  badge?: string;
}

export const HQ_NAV_SECTIONS = [
  "Command",
  "Operations",
  "Finance",
  "Programs",
  "Governance",
  "Enterprise",
  "System",
] as const;

export const HQ_NAV_ITEMS: HQNavItem[] = [
  { label: "Executive Dashboard", path: "/hq", icon: LayoutDashboard, section: "Command" },
  { label: "Founder Command Center", path: "/hq/founder", icon: Briefcase, section: "Command", badge: "New" },
  { label: "Organization Analytics", path: "/hq/analytics", icon: BarChart3, section: "Command" },
  { label: "Enterprise Reporting", path: "/hq/reports", icon: FileBarChart, section: "Command" },
  { label: "Organization Calendar", path: "/hq/calendar", icon: Calendar, section: "Command" },
  { label: "Enterprise Notifications", path: "/hq/notifications", icon: Bell, section: "Command" },
  { label: "Communications Center", path: "/hq/communications", icon: Megaphone, section: "Command" },
  { label: "Mission Control", path: "/hq/phase10", icon: LayoutDashboard, section: "Command", badge: "Phase 10" },
  { label: "Intelligent OS", path: "/hq/phase9", icon: Sparkles, section: "Command", badge: "Phase 9" },
  { label: "Enterprise Intelligence", path: "/hq/intelligence", icon: LineChart, section: "Command", badge: "New" },
  { label: "Workflow Automation", path: "/hq/workflows", icon: GitBranch, section: "Command" },

  { label: "Software Division", path: "/hq/software", icon: Monitor, section: "Operations" },
  { label: "Operations Center", path: "/hq/operations", icon: Package, section: "Operations" },
  { label: "SSO Gateway", path: "/hq/sso", icon: Shield, section: "Operations" },
  { label: "AURA AI Command Center", path: "/hq/aura", icon: Sparkles, section: "Command" },
  { label: "Integrations Hub", path: "/hq/integrations", icon: Plug, section: "Operations" },
  { label: "Developer Portal", path: "/hq/developer", icon: Code2, section: "Operations" },
  { label: "People Management", path: "/hq/people", icon: Users, section: "Operations" },
  { label: "Client & Case Management", path: "/hq/clients", icon: Users, section: "Operations", badge: "M2.2" },
  { label: "My Workspace", path: "/hq/my-workspace", icon: Briefcase, section: "Operations" },
  { label: "Manager Portal", path: "/hq/manager", icon: Users, section: "Operations" },
  { label: "Payroll", path: "/hq/payroll", icon: Wallet, section: "Operations" },
  { label: "Volunteers", path: "/hq/people?type=volunteer", icon: HandHeart, section: "Operations" },

  { label: "Financial Center", path: "/hq/finance", icon: Landmark, section: "Finance" },
  { label: "Grant Center", path: "/hq/grants", icon: FileText, section: "Finance" },
  { label: "AURA Knowledge Base", path: "/hq/knowledge", icon: Brain, section: "Finance", badge: "New" },
  { label: "Donations", path: "/hq/donations", icon: Heart, section: "Finance" },

  { label: "Community Programs", path: "/hq/programs", icon: Users, section: "Programs" },
  { label: "Housing Programs", path: "/hq/housing", icon: Home, section: "Programs" },
  { label: "Scholarship Management", path: "/hq/scholarships", icon: GraduationCap, section: "Programs" },
  { label: "Media Division", path: "/hq/media", icon: Radio, section: "Programs" },

  { label: "Board of Directors Portal", path: "/hq/board", icon: Gavel, section: "Governance" },
  { label: "Compliance & Risk", path: "/hq/compliance", icon: Shield, section: "Governance" },

  { label: "Asset & Inventory", path: "/hq/assets", icon: Package, section: "Enterprise" },
  { label: "Fleet & Vehicles", path: "/hq/fleet", icon: Truck, section: "Enterprise" },
  { label: "Facilities & Property", path: "/hq/facilities", icon: Building, section: "Enterprise" },

  { label: "Document Management", path: "/hq/documents", icon: FolderOpen, section: "System" },
  { label: "Security Center", path: "/hq/security", icon: Shield, section: "System" },
  { label: "Organization Settings", path: "/hq/settings", icon: Settings, section: "System" },
];

export interface HQModuleConfig {
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  status: "live" | "beta" | "coming-soon";
}

export const HQ_MODULE_CONFIGS: Record<string, HQModuleConfig> = {
  operations: {
    title: "Operations Center",
    subtitle: "Unified fleet, assets, facilities, maintenance, and risk management",
    description: "Central command for organizational operations — fleet, inventory, assets, facilities, maintenance, incidents, and compliance risk.",
    features: ["Fleet management", "Asset registry", "Facilities & work orders", "Incident reporting", "Risk register", "Maintenance tracking"],
    status: "live",
  },
  analytics: {
    title: "Organization Analytics",
    subtitle: "Cross-department insights and performance tracking",
    description: "Unified analytics across HR, finance, programs, and the Software Division.",
    features: ["KPI dashboards", "Trend analysis", "Department comparisons", "Export reports"],
    status: "live",
  },
  notifications: {
    title: "Enterprise Notifications",
    subtitle: "Organization-wide alerts and communications",
    description: "Central inbox for system alerts, grant deadlines, HR updates, compliance reminders, and app health warnings.",
    features: ["Alert routing", "Broadcast messages", "App health alerts", "Deadline reminders", "Live activity feed"],
    status: "live",
  },
  volunteers: {
    title: "Volunteer Management",
    subtitle: "Recruit, schedule, and track community volunteers",
    description: "Manage volunteer applications, hours, assignments, and impact across all IFCDC programs.",
    features: ["Volunteer profiles", "Hour tracking", "Assignment scheduling", "Impact reports"],
    status: "live",
  },
  finance: {
    title: "Financial Center",
    subtitle: "Enterprise accounting engine for the entire IFCDC organization",
    description: "Unified financial system — general ledger, budgets, payroll, donations, invoicing, AP/AR, vendors, tax reporting, and audit logs.",
    features: ["General ledger", "Budgets", "Payroll", "Donations", "Invoicing", "AP/AR", "Vendor management", "Tax reporting", "Audit logs"],
    status: "live",
  },
  grants: {
    title: "Grant Center",
    subtitle: "Enterprise funding command hub integrated with the Financial Center",
    description: "Executive dashboard, opportunity finder, writer studio, grant library, calendar, awards, documents vault, funder CRM, compliance, analytics, and notifications.",
    features: ["Writer Studio", "Grant Library", "Opportunity Finder", "Funder CRM", "Compliance center", "Funding analytics", "Financial Center sync"],
    status: "live",
  },
  donations: {
    title: "Donations",
    subtitle: "Donor management and revenue tracking",
    description: "Track one-time and recurring donations across Stripe, PayPal, and other funding sources.",
    features: ["Donor profiles", "Recurring gifts", "Campaign tracking", "Receipt generation"],
    status: "live",
  },
  programs: {
    title: "Community Programs",
    subtitle: "Program enrollment, sessions, and impact",
    description: "Manage all IFCDC community programs including enrollments, sessions, and outcome tracking.",
    features: ["Program dashboards", "Client enrollment", "Session scheduling", "Impact metrics"],
    status: "live",
  },
  clients: {
    title: "Client & Case Management",
    subtitle: "Enterprise caseload registry with shared HQ auth and reporting",
    description: "Client registry, case assignments, goals, assessments, appointments, and people database bridge — integrated with Economic Development and executive analytics.",
    features: ["Client 360 summary", "Caseload assignments", "Goals & assessments", "Appointment calendar", "People registry bridge", "Executive reporting"],
    status: "live",
  },
  housing: {
    title: "Housing Management",
    subtitle: "Housing assistance, applications, and placement tracking",
    description: "Manage housing units, applications, placements, and case management — integrated with People and Programs.",
    features: ["Unit inventory", "Application intake", "Placement tracking", "Case management"],
    status: "live",
  },
  scholarships: {
    title: "Scholarship Management",
    subtitle: "Scholarship programs, applications, and awards",
    description: "Manage scholarship opportunities, applications, selection, and disbursement tracking.",
    features: ["Program catalog", "Application workflow", "Award tracking", "Disbursement logs"],
    status: "live",
  },
  media: {
    title: "Media Division",
    subtitle: "Content, broadcast, and communications",
    description: "Manage IFCDC Radio, content production, social media, and organizational communications.",
    features: ["Content library", "Broadcast scheduling", "Multi-channel publishing", "Media analytics"],
    status: "live",
  },
  knowledge: {
    title: "AURA Knowledge Base",
    subtitle: "IFCDC institutional memory for the enterprise grant writer",
    description: "Secure organizational knowledge base AURA reads before generating any grant content — budgets, program descriptions, financials, registration, mission/vision, and prior approved narratives.",
    features: ["Semantic retrieval", "Auto-indexing on upload", "Version supersession", "Grant grounding", "Reindex from HQ"],
    status: "live",
  },
  documents: {
    title: "Document Management",
    subtitle: "Organizational document vault",
    description: "Central repository for policies, contracts, grant documents, and personnel files — linked to Grants, HR, and Compliance.",
    features: ["Document library", "Version control", "Access permissions", "Category tagging"],
    status: "live",
  },
  assets: {
    title: "Asset & Inventory Management",
    subtitle: "Track organizational assets and equipment",
    description: "Register, assign, and track assets across facilities and departments.",
    features: ["Asset registry", "Location tracking", "Assignment history", "Value tracking"],
    status: "live",
  },
  fleet: {
    title: "Fleet & Vehicle Management",
    subtitle: "Vehicle fleet and maintenance tracking",
    description: "Manage organizational vehicles, assignments, mileage, and maintenance schedules.",
    features: ["Vehicle registry", "Maintenance logs", "Mileage tracking", "Assignment management"],
    status: "live",
  },
  facilities: {
    title: "Facilities & Property Management",
    subtitle: "Properties, maintenance, and work orders",
    description: "Manage IFCDC properties, facilities, and maintenance work orders.",
    features: ["Property registry", "Work orders", "Space management", "Maintenance tracking"],
    status: "live",
  },
  board: {
    title: "Board of Directors Portal",
    subtitle: "Governance, meetings, and board action items",
    description: "Board meeting schedules, agendas, minutes, and action item tracking — connected to Analytics and Financial Center.",
    features: ["Meeting calendar", "Agenda management", "Action items", "Governance reports"],
    status: "live",
  },
  compliance: {
    title: "Compliance & Risk Management",
    subtitle: "Policies, risk register, and organizational compliance",
    description: "Track compliance policies, risk assessments, and mitigation — integrated with Grants and Notifications.",
    features: ["Policy library", "Risk register", "Review schedules", "Compliance alerts"],
    status: "live",
  },
  calendar: {
    title: "Organization Calendar",
    subtitle: "Enterprise-wide events and scheduling",
    description: "Central calendar for meetings, programs, fundraisers, and organization events.",
    features: ["Event scheduling", "Department calendars", "Program events", "Board meetings"],
    status: "live",
  },
  settings: {
    title: "Organization Settings",
    subtitle: "Enterprise configuration and access control",
    description: "Manage organization profile, roles, permissions, integrations, and platform configuration.",
    features: ["Role management", "Permission policies", "Integration settings", "Branding config"],
    status: "beta",
  },
  payroll: {
    title: "Payroll",
    subtitle: "Time tracking, payroll processing, and compensation",
    description: "Review employee hours, process payroll, and manage compensation across funding sources.",
    features: ["Time clock", "Payroll runs", "Funding allocation", "Compensation reports"],
    status: "live",
  },
  people: {
    title: "People Management Center",
    subtitle: "Master people database for the entire IFCDC ecosystem",
    description: "Unified profiles for employees, volunteers, board members, contractors, mentors, program participants, barbers, clients, donors, and grant managers.",
    features: ["Global search", "Organization chart", "Digital personnel files", "Time clock", "Training & certifications", "Barbers App sync"],
    status: "live",
  },
  hr: {
    title: "People Management Center",
    subtitle: "Master people database for the entire IFCDC ecosystem",
    description: "Unified profiles for employees, volunteers, board members, contractors, mentors, program participants, barbers, clients, donors, and grant managers.",
    features: ["Global search", "Organization chart", "Digital personnel files", "Time clock", "Training & certifications", "Barbers App sync"],
    status: "live",
  },
};
