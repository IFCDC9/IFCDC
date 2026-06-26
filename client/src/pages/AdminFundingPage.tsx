import FundingSourcesTable from "../components/FundingSourcesTable";
import FundingLedger from "../components/FundingLedger";
import FundingCharts from "../components/FundingCharts";

export default function AdminFundingPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <nav className="bg-[#111] border-b border-[#333] p-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <a href="/admin" className="text-[#d4af37] font-bold text-xl">IFCDC Admin</a>
          <div className="flex gap-6">
            <a href="/admin" className="text-gray-400 hover:text-[#d4af37]">Dashboard</a>
            <a href="/admin/funding" className="text-[#d4af37]">Funding</a>
            <a href="/" className="text-gray-400 hover:text-[#d4af37]">Public Site</a>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto p-8">
        <h1 className="text-3xl font-bold text-[#d4af37] mb-8">Funding Control Panel</h1>
        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-semibold mb-4">Payment Sources</h2>
            <FundingSourcesTable />
          </section>
          <section>
            <FundingLedger />
          </section>
          <section>
            <FundingCharts />
          </section>
        </div>
      </main>
    </div>
  );
}
