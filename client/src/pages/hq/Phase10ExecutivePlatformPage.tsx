import React from "react";
import HQLayout from "../../layouts/HQLayout";
import { MissionControlCommandCenter } from "../../components/hq/missionControl/MissionControlCommandCenter";

const Phase10ExecutivePlatformPage: React.FC = () => (
  <HQLayout title="Mission Control" subtitle="Operational command center — monitor, direct, approve, and manage IFCDC in real time">
    <MissionControlCommandCenter />
  </HQLayout>
);

export default Phase10ExecutivePlatformPage;
