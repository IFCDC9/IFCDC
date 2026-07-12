import React from "react";
import { Link } from "react-router-dom";
import HQLayout from "../../layouts/HQLayout";
import FundingSourcesAdminPage from "../FundingSourcesAdminPage";

const HqFinancePage: React.FC = () => (
  <HQLayout title="Financial Center" subtitle="Funding sources, accounting, and financial oversight">
    <div style={{ marginBottom: "0.75rem" }}>
      <Link to="/hq/documents?category=financial" className="hq-btn hq-btn-sm hq-btn-ghost">Open Finance Documents →</Link>
    </div>
    <div className="hq-embedded-module">
      <FundingSourcesAdminPage />
    </div>
  </HQLayout>
);

export default HqFinancePage;
