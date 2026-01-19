import { useEffect, useState } from "react";

interface FundingEvent {
  id: string;
  source_key: string;
  intent: string;
  amount_cents: number;
  currency: string;
  external_id: string | null;
  metadata: string | null;
  created_at: string;
}

export default function FundingLedger() {
  const [events, setEvents] = useState<FundingEvent[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    fetch("/api/admin/funding-events", {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(setEvents);
  }, []);

  return (
    <div className="bg-[#111] rounded-lg p-6">
      <h3 className="text-[#d4af37] text-lg font-semibold mb-4">Funding Activity</h3>
      {events.length === 0 ? (
        <p className="text-gray-500">No funding events yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.map(e => (
            <li key={e.id} className="flex items-center justify-between p-3 bg-[#1a1a1a] rounded">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold px-2 py-1 rounded bg-[#222] text-[#d4af37]">
                  {e.source_key.toUpperCase()}
                </span>
                <span className="text-gray-400">{e.intent}</span>
              </div>
              <span className="text-green-400 font-mono">
                ${(e.amount_cents / 100).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
