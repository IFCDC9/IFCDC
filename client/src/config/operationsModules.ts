import type { OperationsOverview } from "../api/operationsApi";
import { OPS_PATHS } from "../api/operationsApi";

export interface OpsColumn {
  key: string;
  label: string;
  format?: "date" | "currency" | "status";
}

export interface OpsTab {
  id: string;
  label: string;
  path: string;
  columns: OpsColumn[];
  createLabel: string;
  createFields: { key: string; label: string; type?: "text" | "number" | "date" | "select"; options?: string[] }[];
}

export interface OpsModuleDef {
  key: string;
  overviewKey: keyof OperationsOverview;
  kpis: { label: string; field: string }[];
  tabs: OpsTab[];
  relatedModules: { label: string; path: string }[];
}

export const OPERATIONS_MODULES: Record<string, OpsModuleDef> = {
  housing: {
    key: "housing",
    overviewKey: "housing",
    kpis: [
      { label: "Total Units", field: "units" },
      { label: "Available", field: "available" },
      { label: "Applications", field: "applications" },
      { label: "Active Placements", field: "placements" },
    ],
    tabs: [
      {
        id: "units", label: "Housing Units", path: OPS_PATHS.housingUnits,
        columns: [{ key: "address", label: "Address" }, { key: "unit_type", label: "Type" }, { key: "status", label: "Status", format: "status" }, { key: "capacity", label: "Capacity" }, { key: "monthly_rent", label: "Rent", format: "currency" }],
        createLabel: "Add Unit",
        createFields: [{ key: "address", label: "Address" }, { key: "unit_type", label: "Type" }, { key: "status", label: "Status", type: "select", options: ["available", "occupied", "maintenance"] }, { key: "capacity", label: "Capacity", type: "number" }, { key: "monthly_rent", label: "Monthly Rent", type: "number" }],
      },
      {
        id: "applications", label: "Applications", path: OPS_PATHS.housingApplications,
        columns: [{ key: "status", label: "Status", format: "status" }, { key: "applied_at", label: "Applied", format: "date" }, { key: "notes", label: "Notes" }],
        createLabel: "New Application",
        createFields: [{ key: "status", label: "Status", type: "select", options: ["pending", "under_review", "approved", "denied"] }, { key: "notes", label: "Notes" }],
      },
      {
        id: "placements", label: "Placements", path: OPS_PATHS.housingPlacements,
        columns: [{ key: "status", label: "Status", format: "status" }, { key: "move_in_date", label: "Move In", format: "date" }, { key: "move_out_date", label: "Move Out", format: "date" }],
        createLabel: "Record Placement",
        createFields: [{ key: "status", label: "Status", type: "select", options: ["active", "completed", "terminated"] }, { key: "move_in_date", label: "Move In Date", type: "date" }, { key: "notes", label: "Notes" }],
      },
    ],
    relatedModules: [{ label: "People Management", path: "/hq/people" }, { label: "Community Programs", path: "/hq/programs" }, { label: "Financial Center", path: "/hq/finance" }],
  },
  scholarships: {
    key: "scholarships",
    overviewKey: "scholarships",
    kpis: [
      { label: "Open Programs", field: "programs" },
      { label: "Applications", field: "applications" },
      { label: "Awarded", field: "awarded" },
    ],
    tabs: [
      {
        id: "programs", label: "Scholarship Programs", path: OPS_PATHS.scholarshipPrograms,
        columns: [{ key: "name", label: "Program" }, { key: "amount", label: "Amount", format: "currency" }, { key: "deadline", label: "Deadline", format: "date" }, { key: "status", label: "Status", format: "status" }],
        createLabel: "Add Program",
        createFields: [{ key: "name", label: "Program Name" }, { key: "amount", label: "Amount", type: "number" }, { key: "deadline", label: "Deadline", type: "date" }, { key: "requirements", label: "Requirements" }],
      },
      {
        id: "applications", label: "Applications", path: OPS_PATHS.scholarshipApplications,
        columns: [{ key: "status", label: "Status", format: "status" }, { key: "amount_requested", label: "Requested", format: "currency" }, { key: "amount_awarded", label: "Awarded", format: "currency" }],
        createLabel: "Log Application",
        createFields: [{ key: "status", label: "Status", type: "select", options: ["submitted", "under_review", "awarded", "denied"] }, { key: "amount_requested", label: "Amount Requested", type: "number" }],
      },
    ],
    relatedModules: [{ label: "People Management", path: "/hq/people" }, { label: "Financial Center", path: "/hq/finance" }],
  },
  media: {
    key: "media",
    overviewKey: "media",
    kpis: [
      { label: "Content Items", field: "content" },
      { label: "Published", field: "published" },
      { label: "Broadcasts", field: "broadcasts" },
    ],
    tabs: [
      {
        id: "content", label: "Content Library", path: OPS_PATHS.mediaContent,
        columns: [{ key: "title", label: "Title" }, { key: "content_type", label: "Type" }, { key: "channel", label: "Channel" }, { key: "status", label: "Status", format: "status" }],
        createLabel: "Add Content",
        createFields: [{ key: "title", label: "Title" }, { key: "content_type", label: "Type", type: "select", options: ["article", "video", "report", "social"] }, { key: "channel", label: "Channel", type: "select", options: ["web", "radio", "social", "email"] }, { key: "description", label: "Description" }],
      },
      {
        id: "broadcasts", label: "Broadcast Schedule", path: OPS_PATHS.mediaBroadcasts,
        columns: [{ key: "title", label: "Show" }, { key: "platform", label: "Platform" }, { key: "scheduled_at", label: "Scheduled", format: "date" }, { key: "status", label: "Status", format: "status" }],
        createLabel: "Schedule Broadcast",
        createFields: [{ key: "title", label: "Title" }, { key: "platform", label: "Platform", type: "select", options: ["radio", "stream", "podcast"] }, { key: "scheduled_at", label: "Scheduled At", type: "date" }],
      },
    ],
    relatedModules: [{ label: "IFCDC Radio", path: "/radio" }, { label: "Software Division", path: "/hq/software" }],
  },
  documents: {
    key: "documents",
    overviewKey: "documents",
    kpis: [{ label: "Documents", field: "total" }],
    tabs: [{
      id: "library", label: "Document Library", path: OPS_PATHS.documents,
      columns: [{ key: "title", label: "Title" }, { key: "category", label: "Category" }, { key: "access_level", label: "Access" }, { key: "version", label: "Version" }, { key: "updated_at", label: "Updated", format: "date" }],
      createLabel: "Upload Document",
      createFields: [{ key: "title", label: "Title" }, { key: "category", label: "Category", type: "select", options: ["policy", "contract", "grant", "hr", "general"] }, { key: "access_level", label: "Access", type: "select", options: ["public", "internal", "confidential", "board"] }],
    }],
    relatedModules: [{ label: "Grant Center", path: "/hq/grants" }, { label: "People Management", path: "/hq/people" }],
  },
  assets: {
    key: "assets",
    overviewKey: "assets",
    kpis: [{ label: "Active Assets", field: "total" }],
    tabs: [{
      id: "inventory", label: "Asset Inventory", path: OPS_PATHS.assets,
      columns: [{ key: "name", label: "Asset" }, { key: "category", label: "Category" }, { key: "asset_tag", label: "Tag" }, { key: "location", label: "Location" }, { key: "status", label: "Status", format: "status" }],
      createLabel: "Register Asset",
      createFields: [{ key: "name", label: "Asset Name" }, { key: "category", label: "Category" }, { key: "asset_tag", label: "Asset Tag" }, { key: "location", label: "Location" }, { key: "value_cents", label: "Value (cents)", type: "number" }],
    }],
    relatedModules: [{ label: "Facilities", path: "/hq/facilities" }, { label: "Financial Center", path: "/hq/finance" }],
  },
  fleet: {
    key: "fleet",
    overviewKey: "fleet",
    kpis: [{ label: "Active Vehicles", field: "vehicles" }, { label: "Service Due", field: "maintenanceDue" }],
    tabs: [
      {
        id: "vehicles", label: "Fleet Vehicles", path: OPS_PATHS.fleetVehicles,
        columns: [{ key: "name", label: "Vehicle" }, { key: "make", label: "Make" }, { key: "model", label: "Model" }, { key: "license_plate", label: "Plate" }, { key: "mileage", label: "Mileage" }, { key: "status", label: "Status", format: "status" }],
        createLabel: "Add Vehicle",
        createFields: [{ key: "name", label: "Name" }, { key: "make", label: "Make" }, { key: "model", label: "Model" }, { key: "year", label: "Year", type: "number" }, { key: "license_plate", label: "License Plate" }],
      },
      {
        id: "maintenance", label: "Maintenance Log", path: OPS_PATHS.fleetMaintenance,
        columns: [{ key: "service_type", label: "Service" }, { key: "service_date", label: "Date", format: "date" }, { key: "cost_cents", label: "Cost", format: "currency" }, { key: "notes", label: "Notes" }],
        createLabel: "Log Service",
        createFields: [{ key: "vehicle_id", label: "Vehicle ID" }, { key: "service_type", label: "Service Type" }, { key: "service_date", label: "Date", type: "date" }, { key: "cost_cents", label: "Cost (cents)", type: "number" }],
      },
    ],
    relatedModules: [{ label: "Facilities", path: "/hq/facilities" }, { label: "Financial Center", path: "/hq/finance" }],
  },
  facilities: {
    key: "facilities",
    overviewKey: "facilities",
    kpis: [{ label: "Properties", field: "properties" }, { label: "Open Work Orders", field: "openWorkOrders" }],
    tabs: [
      {
        id: "properties", label: "Properties", path: OPS_PATHS.facilities,
        columns: [{ key: "name", label: "Property" }, { key: "address", label: "Address" }, { key: "facility_type", label: "Type" }, { key: "sqft", label: "Sq Ft" }, { key: "status", label: "Status", format: "status" }],
        createLabel: "Add Property",
        createFields: [{ key: "name", label: "Name" }, { key: "address", label: "Address" }, { key: "facility_type", label: "Type", type: "select", options: ["office", "warehouse", "residential", "community"] }, { key: "sqft", label: "Square Feet", type: "number" }],
      },
      {
        id: "work-orders", label: "Work Orders", path: OPS_PATHS.workOrders,
        columns: [{ key: "title", label: "Work Order" }, { key: "priority", label: "Priority" }, { key: "status", label: "Status", format: "status" }, { key: "due_date", label: "Due", format: "date" }],
        createLabel: "Create Work Order",
        createFields: [{ key: "facility_id", label: "Facility ID" }, { key: "title", label: "Title" }, { key: "priority", label: "Priority", type: "select", options: ["low", "normal", "high", "urgent"] }],
      },
    ],
    relatedModules: [{ label: "Asset Inventory", path: "/hq/assets" }, { label: "Housing Programs", path: "/hq/housing" }],
  },
  board: {
    key: "board",
    overviewKey: "board",
    kpis: [{ label: "Upcoming Meetings", field: "upcomingMeetings" }, { label: "Open Actions", field: "openActions" }],
    tabs: [
      {
        id: "meetings", label: "Board Meetings", path: OPS_PATHS.boardMeetings,
        columns: [{ key: "title", label: "Meeting" }, { key: "meeting_date", label: "Date", format: "date" }, { key: "location", label: "Location" }, { key: "status", label: "Status", format: "status" }],
        createLabel: "Schedule Meeting",
        createFields: [{ key: "title", label: "Title" }, { key: "meeting_date", label: "Date & Time", type: "date" }, { key: "location", label: "Location" }, { key: "agenda", label: "Agenda" }],
      },
      {
        id: "actions", label: "Action Items", path: OPS_PATHS.boardActions,
        columns: [{ key: "title", label: "Action" }, { key: "status", label: "Status", format: "status" }, { key: "due_date", label: "Due", format: "date" }],
        createLabel: "Add Action Item",
        createFields: [{ key: "title", label: "Title" }, { key: "due_date", label: "Due Date", type: "date" }],
      },
    ],
    relatedModules: [{ label: "Organization Analytics", path: "/hq/analytics" }, { label: "Financial Center", path: "/hq/finance" }, { label: "Grant Center", path: "/hq/grants" }],
  },
  compliance: {
    key: "compliance",
    overviewKey: "compliance",
    kpis: [{ label: "Active Policies", field: "policies" }, { label: "Open Risks", field: "openRisks" }, { label: "High Risks", field: "highRisks" }],
    tabs: [
      {
        id: "policies", label: "Policies", path: OPS_PATHS.compliancePolicies,
        columns: [{ key: "title", label: "Policy" }, { key: "category", label: "Category" }, { key: "review_date", label: "Review Date", format: "date" }, { key: "status", label: "Status", format: "status" }],
        createLabel: "Add Policy",
        createFields: [{ key: "title", label: "Title" }, { key: "category", label: "Category" }, { key: "effective_date", label: "Effective Date", type: "date" }, { key: "review_date", label: "Review Date", type: "date" }],
      },
      {
        id: "risks", label: "Risk Register", path: OPS_PATHS.complianceRisks,
        columns: [{ key: "title", label: "Risk" }, { key: "risk_level", label: "Level" }, { key: "category", label: "Category" }, { key: "status", label: "Status", format: "status" }],
        createLabel: "Log Risk",
        createFields: [{ key: "title", label: "Title" }, { key: "risk_level", label: "Level", type: "select", options: ["low", "medium", "high", "critical"] }, { key: "description", label: "Description" }],
      },
    ],
    relatedModules: [{ label: "Grant Center", path: "/hq/grants" }, { label: "Documents", path: "/hq/documents" }, { label: "Notifications", path: "/hq/notifications" }],
  },
  calendar: {
    key: "calendar",
    overviewKey: "calendar",
    kpis: [{ label: "Upcoming Events", field: "upcomingEvents" }],
    tabs: [{
      id: "events", label: "Organization Calendar", path: OPS_PATHS.calendarEvents,
      columns: [{ key: "title", label: "Event" }, { key: "event_type", label: "Type" }, { key: "start_at", label: "Start", format: "date" }, { key: "location", label: "Location" }, { key: "status", label: "Status", format: "status" }],
      createLabel: "Schedule Event",
      createFields: [{ key: "title", label: "Title" }, { key: "event_type", label: "Type", type: "select", options: ["meeting", "program", "fundraiser", "training", "community"] }, { key: "start_at", label: "Start", type: "date" }, { key: "end_at", label: "End", type: "date" }, { key: "location", label: "Location" }],
    }],
    relatedModules: [{ label: "Community Programs", path: "/hq/programs" }, { label: "Board Portal", path: "/hq/board" }, { label: "People Management", path: "/hq/people" }],
  },
};
