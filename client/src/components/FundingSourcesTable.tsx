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

  useEffect(() => {
    const token = localStorage.getItem("token");
    fetch("/api/admin/funding-sources", {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(setSources);
  }, []);

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
    <table className="w-full border-collapse bg-[#111] rounded-lg overflow-hidden">
      <thead>
        <tr className="bg-[#1a1a1a]">
          <th className="text-left p-4 text-[#d4af37] font-semibold">Source</th>
          <th className="text-left p-4 text-[#d4af37] font-semibold">Status</th>
          <th className="text-left p-4 text-[#d4af37] font-semibold">Mode</th>
          <th className="text-left p-4 text-[#d4af37] font-semibold">Action</th>
        </tr>
      </thead>
      <tbody>
        {sources.map(s => (
          <tr key={s.sourceKey} className="border-b border-[#222] last:border-b-0">
            <td className="p-4">{s.displayName}</td>
            <td className={`p-4 font-semibold ${s.enabled ? "text-green-400" : "text-gray-500"}`}>
              {s.enabled ? "ON" : "OFF"}
            </td>
            <td className={`p-4 ${s.sandbox ? "text-yellow-400" : "text-blue-400"}`}>
              {s.sandbox ? "Sandbox" : "Live"}
            </td>
            <td className="p-4">
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
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
