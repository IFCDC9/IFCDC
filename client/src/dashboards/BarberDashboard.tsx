import React from "react";
import { useAuth } from "../auth/AuthContext";

const BarberDashboard: React.FC = () => {
  const { user } = useAuth();
  const emp = user?.employee;

  return (
    <div style={{ padding: "1.5rem" }}>
      <h1>Barber Dashboard</h1>
      <p>Welcome, {emp?.firstName} {emp?.lastName}</p>

      <section>
        <h2>Today&apos;s Appointments</h2>
        {/* TODO: fetch /api/barbers/{employeeId}/appointments */}
      </section>

      <section>
        <h2>Your Schedule</h2>
        {/* TODO: display barber shifts by employeeId */}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <a href="/my-time">Log My Time</a>
      </section>
    </div>
  );
};

export default BarberDashboard;
