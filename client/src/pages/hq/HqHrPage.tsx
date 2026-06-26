import React from "react";
import HQLayout from "../../layouts/HQLayout";
import HrOnboardingPage from "../HrOnboardingPage";

const HqHrPage: React.FC = () => (
  <HQLayout title="Human Resources" subtitle="Employee records, onboarding, and personnel management">
    <div className="hq-embedded-module">
      <HrOnboardingPage />
    </div>
  </HQLayout>
);

export default HqHrPage;
