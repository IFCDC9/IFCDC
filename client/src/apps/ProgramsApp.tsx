import React, { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";

type Program = {
  id: string;
  name: string;
  code?: string;
  description?: string;
  status?: string;
};

type Session = {
  id: string;
  name: string;
  date: string;
  attendees: number;
};

const ProgramsApp: React.FC = () => {
  const { user, logout } = useAuth();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"programs" | "sessions" | "time">("programs");
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);

  const fetchPrograms = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/programs", { credentials: "include" });
      if (res.ok) {
        setPrograms(await res.json());
      }
    } catch (err) {
      console.error("Error fetching programs:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPrograms();
  }, []);

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  return (
    <div className="standalone-app programs-app" data-testid="programs-app">
      <header className="app-header programs-header">
        <div className="app-header-brand">
          <h1>IFCDC Programs</h1>
        </div>
        <nav className="app-header-nav">
          <button
            className={activeTab === "programs" ? "active" : ""}
            onClick={() => setActiveTab("programs")}
            data-testid="tab-programs"
          >
            Programs
          </button>
          <button
            className={activeTab === "sessions" ? "active" : ""}
            onClick={() => setActiveTab("sessions")}
            data-testid="tab-sessions"
          >
            Sessions
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
        {activeTab === "programs" && (
          <section className="app-section" data-testid="section-programs">
            <h2>Community Programs</h2>
            {loading ? (
              <div className="loading">Loading programs...</div>
            ) : programs.length === 0 ? (
              <div className="empty-state">
                <p>No programs available.</p>
              </div>
            ) : (
              <div className="programs-grid">
                {programs.map((p) => (
                  <div
                    key={p.id}
                    className={`program-card ${selectedProgram?.id === p.id ? "selected" : ""}`}
                    onClick={() => setSelectedProgram(p)}
                    data-testid={`program-${p.id}`}
                  >
                    <div className="program-name">{p.name}</div>
                    {p.code && <div className="program-code">{p.code}</div>}
                    {p.description && <div className="program-desc">{p.description}</div>}
                    <div className="program-actions">
                      <a href={`/programs/${p.id}`} className="btn-link">View Details</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "sessions" && (
          <section className="app-section" data-testid="section-sessions">
            <h2>Program Sessions</h2>
            {selectedProgram ? (
              <div>
                <h3>Sessions for: {selectedProgram.name}</h3>
                <p>Session management coming soon. Use the main portal for now.</p>
                <a href={`/programs/${selectedProgram.id}`} className="btn-link">Go to Program Details</a>
              </div>
            ) : (
              <div className="empty-state">
                <p>Select a program from the Programs tab to view sessions.</p>
              </div>
            )}
          </section>
        )}

        {activeTab === "time" && (
          <section className="app-section" data-testid="section-time">
            <h2>Log My Hours</h2>
            <p>Track your program work hours.</p>
            <a href="/my-time" className="btn-link">Open Time Tracker</a>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>IFCDC Community Programs | Empowering Our Community</p>
      </footer>
    </div>
  );
};

export default ProgramsApp;
