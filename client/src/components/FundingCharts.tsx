import { useEffect, useState } from "react";

interface MetricRow {
  source_key: string;
  total: number;
}

export default function FundingCharts() {
  const [data, setData] = useState<MetricRow[]>([]);

  useEffect(() => {
    const load = async () => {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/admin/funding-metrics", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      setData(await res.json());
    };

    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#111] rounded-lg p-6">
      <h3 className="text-[#d4af37] text-lg font-semibold mb-4">Total Funds by Source</h3>
      {data.length === 0 ? (
        <p className="text-gray-500">No funding data yet.</p>
      ) : (
        <div className="space-y-3">
          {data.map(d => (
            <div key={d.source_key} className="flex items-center justify-between p-3 bg-[#1a1a1a] rounded">
              <span className="text-xs font-bold px-2 py-1 rounded bg-[#222] text-[#d4af37]">
                {d.source_key.toUpperCase()}
              </span>
              <span className="text-green-400 font-mono text-lg">
                ${(d.total / 100).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
