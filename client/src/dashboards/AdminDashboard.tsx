import React from "react";
import CustomizableDashboard from "../components/CustomizableDashboard";

const AdminDashboard: React.FC = () => {
  return (
    <div data-testid="admin-dashboard">
      <CustomizableDashboard />

      <div style={{ marginTop: "2rem", padding: "0 16px" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "#1a1a2e" }}>
          Quick Links
        </h2>
        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <a
            href="/admin/hr"
            style={{
              background: "#FFFFFF",
              borderRadius: "0.75rem",
              padding: "1rem",
              textDecoration: "none",
              color: "#111827",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
            data-testid="link-hr"
          >
            <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>HR / Staff</h3>
            <p style={{ fontSize: "0.85rem", color: "#6B7280" }}>
              Onboard staff, manage roles, and maintain employee records.
            </p>
          </a>

          <a
            href="/programs"
            style={{
              background: "#FFFFFF",
              borderRadius: "0.75rem",
              padding: "1rem",
              textDecoration: "none",
              color: "#111827",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
            data-testid="link-programs"
          >
            <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>Programs</h3>
            <p style={{ fontSize: "0.85rem", color: "#6B7280" }}>
              Track enrollments, sessions, and impact across IFCDC programs.
            </p>
          </a>

          <a
            href="/admin/time"
            style={{
              background: "#FFFFFF",
              borderRadius: "0.75rem",
              padding: "1rem",
              textDecoration: "none",
              color: "#111827",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
            data-testid="link-time-payroll"
          >
            <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>
              Time & Payroll
            </h3>
            <p style={{ fontSize: "0.85rem", color: "#6B7280" }}>
              Review hours and costs by employee, program, and funding source.
            </p>
          </a>

          <a
            href="/admin/grant-report"
            style={{
              background: "#FFFFFF",
              borderRadius: "0.75rem",
              padding: "1rem",
              textDecoration: "none",
              color: "#111827",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
            data-testid="link-grant-reports"
          >
            <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>
              Grant Reports
            </h3>
            <p style={{ fontSize: "0.85rem", color: "#6B7280" }}>
              Generate agency-ready reports by funding source and reporting period.
            </p>
          </a>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
