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

const RadioApp: React.FC = () => {
  const { user, logout } = useAuth();
  const [shows, setShows] = useState<RadioShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"shows" | "content" | "time">("shows");
  const [contentTopic, setContentTopic] = useState("");
  const [contentType, setContentType] = useState("announcement");
  const [generatedContent, setGeneratedContent] = useState("");
  const [generating, setGenerating] = useState(false);

  const fetchShows = async () => {
    setLoading(true);
    const res = await fetch("/api/radio/my-shows", { credentials: "include" });
    setLoading(false);
    if (res.ok) {
      setShows(await res.json());
    }
  };

  useEffect(() => {
    fetchShows();
  }, []);

  const handleGenerateContent = async () => {
    if (!contentTopic.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/radio-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ topic: contentTopic, contentType }),
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedContent(data.content);
      }
    } catch (err) {
      console.error("Error generating content:", err);
    }
    setGenerating(false);
  };

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  const grouped: { [day: number]: RadioShow[] } = {};
  shows.forEach((s) => {
    if (!grouped[s.dayOfWeek]) grouped[s.dayOfWeek] = [];
    grouped[s.dayOfWeek].push(s);
  });

  return (
    <div className="standalone-app radio-app" data-testid="radio-app">
      <header className="app-header radio-header">
        <div className="app-header-brand">
          <h1>IFCDC Radio</h1>
        </div>
        <nav className="app-header-nav">
          <button
            className={activeTab === "shows" ? "active" : ""}
            onClick={() => setActiveTab("shows")}
            data-testid="tab-shows"
          >
            My Shows
          </button>
          <button
            className={activeTab === "content" ? "active" : ""}
            onClick={() => setActiveTab("content")}
            data-testid="tab-content"
          >
            Content Generator
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
        {activeTab === "shows" && (
          <section className="app-section" data-testid="section-shows">
            <h2>My Weekly Shows</h2>
            {loading ? (
              <div className="loading">Loading shows...</div>
            ) : shows.length === 0 ? (
              <div className="empty-state">
                <p>No shows assigned yet. Check with the station admin.</p>
              </div>
            ) : (
              <div className="shows-schedule">
                {Object.keys(grouped)
                  .sort((a, b) => Number(a) - Number(b))
                  .map((key) => {
                    const day = Number(key);
                    const dayShows = grouped[day];
                    return (
                      <div key={day} className="day-schedule">
                        <h3 className="day-name">{dayLabel(day)}</h3>
                        <div className="shows-list">
                          {dayShows.map((s) => (
                            <div key={s.id} className="show-card" data-testid={`show-${s.id}`}>
                              <div className="show-time">
                                {s.startTime} - {s.endTime}
                              </div>
                              <div className="show-details">
                                <div className="show-title">{s.title}</div>
                                {s.description && <div className="show-desc">{s.description}</div>}
                              </div>
                              <div className="show-badges">
                                <span className={`badge ${s.isLive ? "live" : "recorded"}`}>
                                  {s.isLive ? "LIVE" : "Pre-recorded"}
                                </span>
                                <span className={`badge status-${s.status}`}>{s.status}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}

        {activeTab === "content" && (
          <section className="app-section" data-testid="section-content">
            <h2>AI Content Generator</h2>
            <p>Generate radio content with AI assistance.</p>
            <div className="content-generator">
              <div className="form-group">
                <label>Content Type</label>
                <select value={contentType} onChange={(e) => setContentType(e.target.value)} data-testid="select-content-type">
                  <option value="announcement">Announcement</option>
                  <option value="interview_intro">Interview Intro</option>
                  <option value="segment_transition">Segment Transition</option>
                  <option value="community_message">Community Message</option>
                </select>
              </div>
              <div className="form-group">
                <label>Topic</label>
                <input
                  type="text"
                  value={contentTopic}
                  onChange={(e) => setContentTopic(e.target.value)}
                  placeholder="e.g., Mental health awareness week"
                  data-testid="input-topic"
                />
              </div>
              <button onClick={handleGenerateContent} disabled={generating || !contentTopic.trim()} data-testid="btn-generate">
                {generating ? "Generating..." : "Generate Content"}
              </button>
              {generatedContent && (
                <div className="generated-content" data-testid="generated-content">
                  <h4>Generated Content:</h4>
                  <div className="content-box">{generatedContent}</div>
                  <button onClick={() => navigator.clipboard.writeText(generatedContent)}>Copy to Clipboard</button>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "time" && (
          <section className="app-section" data-testid="section-time">
            <h2>Log My Hours</h2>
            <p>Track your radio show hours.</p>
            <a href="/my-time" className="btn-link">Open Time Tracker</a>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>IFCDC Radio | Your Community Voice</p>
      </footer>
    </div>
  );
};

export default RadioApp;
