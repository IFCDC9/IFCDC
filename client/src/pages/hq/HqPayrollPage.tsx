import React from "react";
import HQLayout from "../../layouts/HQLayout";
import { PayrollTimeCenter } from "../../components/hq/people/PayrollTimeCenter";

const HqPayrollPage: React.FC = () => (
  <HQLayout title="Payroll & Time" subtitle="Time tracking, PTO, payroll reporting, and grant-funded staff">
    <PayrollTimeCenter />
  </HQLayout>
);

export default HqPayrollPage;
