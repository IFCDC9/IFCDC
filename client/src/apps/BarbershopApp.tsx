import React, { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";

type Client = {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
};

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  serviceName: string;
  status: string;
  notes?: string | null;
  client: Client;
};

const BarbershopApp: React.FC = () => {
  const { user, logout } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<"schedule" | "book" | "time">("schedule");

  const fetchSchedule = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (date) {
      params.append("dateFrom", date);
      params.append("dateTo", date);
    }
    const res = await fetch(`/api/barber/schedule?${params.toString()}`, { credentials: "include" });
    setLoading(false);
    if (res.ok) {
      setAppointments(await res.json());
    }
  };

  useEffect(() => {
    fetchSchedule();
  }, [date]);

  const handleStatusChange = async (id: string, status: string) => {
    const res = await fetch(`/api/barber/appointments/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status }),
    });
    if (res.ok) fetchSchedule();
  };

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  return (
    <div className="standalone-app barbershop-app" data-testid="barbershop-app">
      <header className="app-header barbershop-header">
        <div className="app-header-brand">
          <h1>IFCDC Barbershop</h1>
        </div>
        <nav className="app-header-nav">
          <button 
            className={activeTab === "schedule" ? "active" : ""} 
            onClick={() => setActiveTab("schedule")}
            data-testid="tab-schedule"
          >
            Schedule
          </button>
          <button 
            className={activeTab === "book" ? "active" : ""} 
            onClick={() => setActiveTab("book")}
            data-testid="tab-book"
          >
            Book Client
          </button>
          <button 
            className={activeTab === "time" ? "active" : ""} 
            onClick={() => setActiveTab("time")}
            data-testid="tab-time"
          >
            My Hours
          </button>
        </nav>
        <div className="app-header-user">
          <span>{user?.name || user?.email}</span>
          <button onClick={handleLogout} data-testid="btn-logout">Logout</button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === "schedule" && (
          <section className="app-section" data-testid="section-schedule">
            <div className="section-header">
              <h2>Today's Schedule</h2>
              <div className="date-picker">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  data-testid="input-date"
                />
                <button onClick={fetchSchedule} data-testid="btn-refresh">Refresh</button>
              </div>
            </div>

            {loading ? (
              <div className="loading">Loading appointments...</div>
            ) : appointments.length === 0 ? (
              <div className="empty-state">
                <p>No appointments scheduled for this day.</p>
              </div>
            ) : (
              <div className="appointments-list">
                {appointments.map((a) => (
                  <div key={a.id} className={`appointment-card status-${a.status}`} data-testid={`appointment-${a.id}`}>
                    <div className="appointment-time">
                      {new Date(a.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {" - "}
                      {new Date(a.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="appointment-details">
                      <div className="client-name">{a.client.firstName} {a.client.lastName}</div>
                      {a.client.phone && <div className="client-phone">{a.client.phone}</div>}
                      <div className="service-name">{a.serviceName}</div>
                    </div>
                    <div className="appointment-status">
                      <span className={`status-badge ${a.status}`}>{a.status}</span>
                    </div>
                    {a.status === "scheduled" && (
                      <div className="appointment-actions">
                        <button onClick={() => handleStatusChange(a.id, "completed")} className="btn-complete">Complete</button>
                        <button onClick={() => handleStatusChange(a.id, "no_show")} className="btn-noshow">No-Show</button>
                        <button onClick={() => handleStatusChange(a.id, "cancelled")} className="btn-cancel">Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "book" && (
          <section className="app-section" data-testid="section-book">
            <h2>Book a Client</h2>
            <p>Client booking form coming soon. Use the main admin portal for now.</p>
            <a href="/admin" className="btn-link">Go to Admin Portal</a>
          </section>
        )}

        {activeTab === "time" && (
          <section className="app-section" data-testid="section-time">
            <h2>Log My Hours</h2>
            <p>Time tracking for your work hours.</p>
            <a href="/my-time" className="btn-link">Open Time Tracker</a>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>IFCDC Barbershop | Part of Imperial Foundation CDC</p>
      </footer>
    </div>
  );
};

export default BarbershopApp;
