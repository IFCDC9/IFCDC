import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type Participant = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
};

type Enrollment = {
  id: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  participant: Participant;
};

type Session = {
  id: string;
  title: string;
  date: string;
  durationMin?: number | null;
  notes?: string | null;
};

type Program = {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  location?: string | null;
  status: string;
  enrollments: Enrollment[];
  sessions: Session[];
};

const ProgramDetailPage: React.FC = () => {
  const { programId } = useParams();
  const { user } = useAuth();

  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionForm, setSessionForm] = useState({
    title: "",
    date: "",
    durationMin: "",
    notes: "",
  });
  const [savingSession, setSavingSession] = useState(false);

  const isAdminOrStaff =
    user && (user.role === "admin" || user.role === "program_staff");

  const fetchProgram = async () => {
    if (!programId) return;
    setLoading(true);
    const res = await fetch(`/api/programs/${programId}`, {
      credentials: "include",
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json();
      setProgram(data);
    } else {
      alert("Error loading program.");
    }
  };

  useEffect(() => {
    fetchProgram();
  }, [programId]);

  const handleSessionChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setSessionForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!programId) return;
    if (!sessionForm.title || !sessionForm.date) {
      alert("Title and date required.");
      return;
    }

    setSavingSession(true);
    const res = await fetch(`/api/programs/${programId}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        title: sessionForm.title,
        date: sessionForm.date,
        durationMin: sessionForm.durationMin || undefined,
        notes: sessionForm.notes || undefined,
      }),
    });
    setSavingSession(false);

    if (res.ok) {
      setSessionForm({ title: "", date: "", durationMin: "", notes: "" });
      fetchProgram();
    } else {
      alert("Error creating session.");
    }
  };

  if (loading) {
    return <div style={{ padding: "1.5rem" }}>Loading program…</div>;
  }

  if (!program) {
    return <div style={{ padding: "1.5rem" }}>Program not found.</div>;
  }

  const activeParticipants = program.enrollments.map((e) => e.participant);

  return (
    <div style={{ padding: "1.5rem" }}>
      <h1 data-testid="text-program-name">{program.name}</h1>
      {program.code && <div data-testid="text-program-code">Code: {program.code}</div>}
      {program.location && <div data-testid="text-program-location">Location: {program.location}</div>}
      <div data-testid="text-program-status">Status: {program.status}</div>
      {program.description && (
        <p style={{ marginTop: "0.75rem" }} data-testid="text-program-description">{program.description}</p>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h2>At a Glance</h2>
        <ul>
          <li data-testid="text-participant-count">Active participants: {activeParticipants.length}</li>
          <li data-testid="text-session-count">Total sessions logged: {program.sessions.length}</li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Participants</h2>
        {activeParticipants.length === 0 ? (
          <p>No active participants enrolled yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Email</th>
                <th align="left">Phone</th>
              </tr>
            </thead>
            <tbody>
              {activeParticipants.map((p) => (
                <tr key={p.id} data-testid={`row-participant-${p.id}`}>
                  <td>
                    {p.firstName} {p.lastName}
                  </td>
                  <td>{p.email || "-"}</td>
                  <td>{p.phone || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Sessions</h2>
        {program.sessions.length === 0 ? (
          <p>No sessions logged yet.</p>
        ) : (
          <ul>
            {program.sessions.map((s) => (
              <li key={s.id} style={{ marginBottom: "0.5rem" }} data-testid={`session-item-${s.id}`}>
                <strong>{s.title}</strong> –{" "}
                {new Date(s.date).toLocaleString()}{" "}
                {s.durationMin ? `(${s.durationMin} min)` : ""}
                {s.notes && <div>Notes: {s.notes}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdminOrStaff && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Log a New Session</h2>
          <form
            onSubmit={handleSessionSubmit}
            style={{ maxWidth: 480, display: "grid", gap: "0.75rem" }}
          >
            <input
              name="title"
              placeholder="Session title (e.g. Mentorship Circle, Life Skills Workshop)"
              value={sessionForm.title}
              onChange={handleSessionChange}
              required
              data-testid="input-session-title"
            />
            <input
              type="datetime-local"
              name="date"
              value={sessionForm.date}
              onChange={handleSessionChange}
              required
              data-testid="input-session-date"
            />
            <input
              name="durationMin"
              placeholder="Duration (minutes)"
              value={sessionForm.durationMin}
              onChange={handleSessionChange}
              data-testid="input-session-duration"
            />
            <textarea
              name="notes"
              placeholder="Notes (what you covered, important events, etc.)"
              value={sessionForm.notes}
              onChange={handleSessionChange}
              rows={3}
              data-testid="input-session-notes"
            />
            <button type="submit" disabled={savingSession} data-testid="button-save-session">
              {savingSession ? "Saving…" : "Save Session"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
};

export default ProgramDetailPage;
