import React from "react";
import HQLayout from "../../layouts/HQLayout";
import FundingSourcesAdminPage from "../FundingSourcesAdminPage";

const HqFinancePage: React.FC = () => (
  <HQLayout title="Financial Center" subtitle="Funding sources, accounting, and financial oversight">
    <div className="hq-embedded-module">
      <FundingSourcesAdminPage />
    </div>
  </HQLayout>
);

export default HqFinancePage;
