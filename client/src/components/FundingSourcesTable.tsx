import { useEffect, useState } from "react";

interface FundingSource {
  id: string;
  sourceKey: string;
  displayName: string;
  enabled: boolean;
  sandbox: boolean;
  createdAt: string;
}

export default function FundingSourcesTable() {
  const [sources, setSources] = useState<FundingSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState("");
  const [agency, setAgency] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    fetch("/api/admin/funding-sources", {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(setSources);
  }, []);

  const createFundingSource = async () => {
    const token = localStorage.getItem("token");
    const payload = { name, code, type, agency, notes };

    const res = await fetch("/api/admin/funding-sources", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      alert("Failed to create funding source");
      return;
    }

    const newSource = await res.json();
    setSources(prev => [...prev, {
      id: newSource.id,
      sourceKey: newSource.source_key || code,
      displayName: newSource.display_name || name,
      enabled: !!newSource.enabled,
      sandbox: !!newSource.sandbox,
      createdAt: newSource.created_at
    }]);
    setShowForm(false);
    setName(""); setCode(""); setType(""); setAgency(""); setNotes("");
  };

  const deleteFundingSource = async (id: string) => {
    if (!confirm("Delete this funding source?")) return;
    const token = localStorage.getItem("token");
    await fetch(`/api/admin/funding-sources/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    setSources(prev => prev.filter(s => s.id !== id));
  };

  const toggleSource = async (key: string, enabled: boolean) => {
    const token = localStorage.getItem("token");
    await fetch(`/api/admin/funding-sources/${key}`, {
      method: "PATCH",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ enabled })
    });

    setSources(prev =>
      prev.map(s =>
        s.sourceKey === key ? { ...s, enabled } : s
      )
    );
  };

  return (
    <div>
      <div className="mb-4">
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-[#d4af37] text-black rounded font-medium hover:bg-[#c4a030]"
        >
          {showForm ? "Cancel" : "+ Add Funding Source"}
        </button>
      </div>

      {showForm && (
        <div className="bg-[#1a1a1a] p-4 rounded-lg mb-4 grid grid-cols-2 gap-4">
          <input
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="p-2 bg-[#222] border border-[#333] rounded text-white"
          />
          <input
            placeholder="Code"
            value={code}
            onChange={e => setCode(e.target.value)}
            className="p-2 bg-[#222] border border-[#333] rounded text-white"
          />
          <input
            placeholder="Type"
            value={type}
            onChange={e => setType(e.target.value)}
            className="p-2 bg-[#222] border border-[#333] rounded text-white"
          />
          <input
            placeholder="Agency"
            value={agency}
            onChange={e => setAgency(e.target.value)}
            className="p-2 bg-[#222] border border-[#333] rounded text-white"
          />
          <textarea
            placeholder="Notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="p-2 bg-[#222] border border-[#333] rounded text-white col-span-2"
          />
          <button
            onClick={createFundingSource}
            className="px-4 py-2 bg-green-700 text-white rounded font-medium hover:bg-green-600 col-span-2"
          >
            Create
          </button>
        </div>
      )}

      <table className="w-full border-collapse bg-[#111] rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-[#1a1a1a]">
            <th className="text-left p-4 text-[#d4af37] font-semibold">Source</th>
            <th className="text-left p-4 text-[#d4af37] font-semibold">Status</th>
            <th className="text-left p-4 text-[#d4af37] font-semibold">Mode</th>
            <th className="text-left p-4 text-[#d4af37] font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sources.map(s => (
            <tr key={s.id} className="border-b border-[#222] last:border-b-0">
              <td className="p-4">{s.displayName}</td>
              <td className={`p-4 font-semibold ${s.enabled ? "text-green-400" : "text-gray-500"}`}>
                {s.enabled ? "ON" : "OFF"}
              </td>
              <td className={`p-4 ${s.sandbox ? "text-yellow-400" : "text-blue-400"}`}>
                {s.sandbox ? "Sandbox" : "Live"}
              </td>
              <td className="p-4 flex gap-2">
                <button
                  onClick={() => toggleSource(s.sourceKey, !s.enabled)}
                  className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                    s.enabled 
                      ? "bg-red-900 hover:bg-red-800 text-white" 
                      : "bg-green-900 hover:bg-green-800 text-white"
                  }`}
                >
                  {s.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => deleteFundingSource(s.id)}
                  className="px-4 py-2 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
