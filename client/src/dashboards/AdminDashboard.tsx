import React from "react";
import IFCDCHeader from "../components/IFCDCHeader";
import CustomizableDashboard from "../components/CustomizableDashboard";

const AdminDashboard: React.FC = () => {
  return (
    <>
      <IFCDCHeader />

      <main className="role-page" data-testid="admin-dashboard">
        <h1 className="role-title">Admin Control Center</h1>
        <p className="role-subtitle">
          Centralized view for IFCDC operations: barbershop bookings, radio line, community programs,
          and user management.
        </p>

        <div className="admin-widgets">
          <CustomizableDashboard />
        </div>

        <div className="admin-quick-links">
          <h2 className="quick-links-title">Quick Links</h2>
          <div className="quick-links-grid">
            <a href="/admin/hr" className="quick-link-card" data-testid="link-hr">
              <h3>HR / Staff</h3>
              <p>Onboard staff, manage roles, and maintain employee records.</p>
            </a>

            <a href="/programs" className="quick-link-card" data-testid="link-programs">
              <h3>Programs</h3>
              <p>Track enrollments, sessions, and impact across IFCDC programs.</p>
            </a>

            <a href="/admin/time" className="quick-link-card" data-testid="link-time-payroll">
              <h3>Time & Payroll</h3>
              <p>Review hours and costs by employee, program, and funding source.</p>
            </a>

            <a href="/admin/grant-report" className="quick-link-card" data-testid="link-grant-reports">
              <h3>Grant Reports</h3>
              <p>Generate agency-ready reports by funding source and reporting period.</p>
            </a>
          </div>
        </div>
      </main>
    </>
  );
};

export default AdminDashboard;
