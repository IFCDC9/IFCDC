import React from "react";
import HQLayout from "../../layouts/HQLayout";
import { ModulePlaceholder } from "../../components/hq/ModulePlaceholder";
import { HQ_MODULE_CONFIGS } from "../../config/hqNavigation";

interface HqModulePageProps {
  moduleKey: keyof typeof HQ_MODULE_CONFIGS;
  children?: React.ReactNode;
}

const HqModulePage: React.FC<HqModulePageProps> = ({ moduleKey, children }) => {
  const config = HQ_MODULE_CONFIGS[moduleKey];

  return (
    <HQLayout title={config.title} subtitle={config.subtitle}>
      {children ?? <ModulePlaceholder config={config} ctaTo="/hq" />}
    </HQLayout>
  );
};

export default HqModulePage;
