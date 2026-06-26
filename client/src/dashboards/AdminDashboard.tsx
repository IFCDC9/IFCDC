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
          <h2 className="quick-links-title">IFCDC Headquarters</h2>
          <div className="quick-links-grid">
            <a href="/hq" className="quick-link-card" data-testid="link-hq-executive">
              <h3>Executive Dashboard</h3>
              <p>Organization health, platform services, and module access.</p>
            </a>

            <a href="/hq/software" className="quick-link-card" data-testid="link-hq-software">
              <h3>Software Division</h3>
              <p>Monitor all IFCDC applications — Barbers, Music, Tapis, and more.</p>
            </a>

            <a href="/hq/aura" className="quick-link-card" data-testid="link-hq-aura">
              <h3>AURA Command Center</h3>
              <p>Enterprise AI for reports, HR, grants, finance, and operations.</p>
            </a>
          </div>
        </div>

        <div className="admin-quick-links">
          <h2 className="quick-links-title">Standalone Apps</h2>
          <div className="quick-links-grid">
            <a href="/app/barbershop" className="quick-link-card app-link-barbershop" data-testid="link-app-barbershop">
              <h3>Barbershop App</h3>
              <p>Dedicated view for barbershop scheduling, appointments, and services.</p>
            </a>

            <a href="/app/radio" className="quick-link-card app-link-radio" data-testid="link-app-radio">
              <h3>Radio App</h3>
              <p>Manage radio shows, generate content, and track broadcast schedules.</p>
            </a>

            <a href="/app/programs" className="quick-link-card app-link-programs" data-testid="link-app-programs">
              <h3>Programs App</h3>
              <p>Community programs dashboard for sessions, clients, and impact tracking.</p>
            </a>
          </div>
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
