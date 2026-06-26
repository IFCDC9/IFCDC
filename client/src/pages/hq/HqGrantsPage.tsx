import React from "react";
import HQLayout from "../../layouts/HQLayout";
import GrantReportPage from "../GrantReportPage";

const HqGrantsPage: React.FC = () => (
  <HQLayout title="Grant Center" subtitle="Grant tracking, applications, and compliance reporting">
    <div className="hq-embedded-module">
      <GrantReportPage />
    </div>
  </HQLayout>
);

export default HqGrantsPage;
