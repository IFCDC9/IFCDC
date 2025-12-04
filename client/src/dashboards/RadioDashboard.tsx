import React from "react";
import { useAuth } from "../auth/AuthContext";

const RadioDashboard: React.FC = () => {
  const { user } = useAuth();
  const emp = user?.employee;

  return (
    <div style={{ padding: "1.5rem" }}>
      <h1>Radio Host Dashboard</h1>
      <p>Welcome, {emp?.firstName} {emp?.lastName}</p>

      <section>
        <h2>Your Shows</h2>
        {/* TODO: /api/radio/hosts/{employeeId}/shows */}
      </section>

      <section>
        <h2>Recent Shoutouts / Messages</h2>
        {/* TODO: /api/radio/hosts/{employeeId}/messages */}
      </section>
    </div>
  );
};

export default RadioDashboard;
