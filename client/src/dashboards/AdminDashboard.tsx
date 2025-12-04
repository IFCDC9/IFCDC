import React from "react";
import { useAuth } from "../auth/AuthContext";

const AdminDashboard: React.FC = () => {
  const { user } = useAuth();

  return (
    <div style={{ padding: "1.5rem" }}>
      <h1>IFCDC Admin Dashboard</h1>
      <p>Welcome, {user?.employee?.firstName || user?.email}</p>

      <ul>
        <li><a href="/admin/hr">HR – Staff Onboarding</a></li>
        <li><a href="/admin/staff">View All Staff</a></li>
        <li><a href="/admin/grants">Grants & Reporting</a></li>
        <li><a href="/admin/system">System Settings</a></li>
      </ul>
    </div>
  );
};

export default AdminDashboard;
