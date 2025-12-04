import React, { useEffect, useState } from "react";

type FundingSource = {
  id: string;
  name: string;
};

type TimeEntry = {
  id: string;
  date: string;
  hours: number;
  notes?: string | null;
  fundingSource?: FundingSource | null;
};

const MyTimeEntriesPage: React.FC = () => {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: "",
    hours: "",
    fundingSourceId: "",
    notes: "",
  });

  const token = localStorage.getItem("ifcdc_token");

  const fetchEntries = async () => {
    setLoading(true);
    const res = await fetch("/api/time-entries/my", {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
      },
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json();
      setEntries(data);
    } else {
      alert("Error loading your time entries.");
    }
  };

  const fetchFundingSources = async () => {
    const res = await fetch("/api/funding-sources", {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
      },
    });
    if (res.ok) {
      const data = await res.json();
      setFundingSources(data);
    }
  };

  useEffect(() => {
    fetchEntries();
    fetchFundingSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.date || !form.hours) {
      alert("Date and hours are required.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/time-entries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify(form),
    });
    setSaving(false);

    if (res.ok) {
      setForm({ date: "", hours: "", fundingSourceId: "", notes: "" });
      fetchEntries();
    } else {
      alert("Error saving time entry.");
    }
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <h1>My Time Entries</h1>

      <section style={{ marginTop: "1rem", marginBottom: "2rem" }}>
        <h2>Log Time</h2>
        <form
          onSubmit={handleSubmit}
          style={{ maxWidth: 480, display: "grid", gap: "0.75rem" }}
        >
          <div>
            <label>Date & Time</label>
            <input
              type="datetime-local"
              name="date"
              value={form.date}
              onChange={handleChange}
              required
              data-testid="input-time-date"
            />
          </div>
          <div>
            <label>Hours</label>
            <input
              type="number"
              step="0.25"
              name="hours"
              value={form.hours}
              onChange={handleChange}
              required
              data-testid="input-time-hours"
            />
          </div>
          <div>
            <label>Funding Source (optional)</label>
            <select
              name="fundingSourceId"
              value={form.fundingSourceId}
              onChange={handleChange}
              data-testid="select-time-funding-source"
            >
              <option value="">-- None / General --</option>
              {fundingSources.map(fs => (
                <option key={fs.id} value={fs.id}>
                  {fs.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              placeholder="What did you work on?"
              data-testid="input-time-notes"
            />
          </div>
          <button type="submit" disabled={saving} data-testid="button-save-time">
            {saving ? "Saving..." : "Save Time Entry"}
          </button>
        </form>
      </section>

      <section>
        <h2>History</h2>
        {loading ? (
          <p>Loading…</p>
        ) : entries.length === 0 ? (
          <p>No entries yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Date</th>
                <th align="left">Hours</th>
                <th align="left">Funding Source</th>
                <th align="left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} data-testid={`row-time-entry-${e.id}`}>
                  <td>{new Date(e.date).toLocaleString()}</td>
                  <td>{e.hours}</td>
                  <td>{e.fundingSource?.name || "-"}</td>
                  <td>{e.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default MyTimeEntriesPage;
