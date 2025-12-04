import React, { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";

type RadioShow = {
  id: string;
  title: string;
  description?: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isLive: boolean;
  status: string;
};

const dayLabel = (d: number) =>
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d] || "";

const RadioDashboard: React.FC = () => {
  const { user } = useAuth();
  const token = localStorage.getItem("ifcdc_token");

  const [shows, setShows] = useState<RadioShow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchShows = async () => {
    setLoading(true);
    const res = await fetch("/api/radio/my-shows", {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
      },
    });
    setLoading(false);

    if (res.ok) {
      const data = await res.json();
      setShows(data);
    } else {
      alert("Error loading your radio shows.");
    }
  };

  useEffect(() => {
    fetchShows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayName = user?.employee
    ? `${user.employee.firstName} ${user.employee.lastName}`
    : user?.email;

  const grouped: { [day: number]: RadioShow[] } = {};
  shows.forEach(s => {
    if (!grouped[s.dayOfWeek]) grouped[s.dayOfWeek] = [];
    grouped[s.dayOfWeek].push(s);
  });

  return (
    <div style={{ padding: "1.5rem" }} data-testid="radio-dashboard">
      <h1>Radio Host Dashboard</h1>
      <p>Welcome, {displayName}</p>

      <section style={{ marginTop: "1rem", marginBottom: "1rem" }}>
        <h2>My Weekly Shows</h2>
        {loading ? (
          <p>Loading…</p>
        ) : shows.length === 0 ? (
          <p>No shows assigned yet. Check with the station admin.</p>
        ) : (
          Object.keys(grouped)
            .sort((a, b) => Number(a) - Number(b))
            .map(key => {
              const day = Number(key);
              const dayShows = grouped[day];
              return (
                <div key={day} style={{ marginBottom: "1rem" }}>
                  <h3>{dayLabel(day)}</h3>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th align="left">Time</th>
                        <th align="left">Show</th>
                        <th align="left">Live?</th>
                        <th align="left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayShows.map(s => (
                        <tr key={s.id} data-testid={`row-show-${s.id}`}>
                          <td>
                            {s.startTime} – {s.endTime}
                          </td>
                          <td>
                            <strong>{s.title}</strong>
                            {s.description && (
                              <div style={{ fontSize: "0.85rem" }}>
                                {s.description}
                              </div>
                            )}
                          </td>
                          <td>{s.isLive ? "Yes" : "Pre-recorded"}</td>
                          <td>{s.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Operations</h2>
        <ul>
          <li>
            <a href="/my-time">Log My Time (Radio Hours)</a>
          </li>
        </ul>
      </section>
    </div>
  );
};

export default RadioDashboard;
