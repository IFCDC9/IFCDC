import React, { Suspense } from "react";
import HQLayout from "../../layouts/HQLayout";
import type { AuraButtonId } from "./aura/AuraActionButtons";
import { HqErrorBoundary } from "./HqErrorBoundary";
import { HqAuthGate } from "./HqAuthGate";
import { HqLoading } from "./HqLoading";

interface HqShellRouteProps {
  path: string;
  title?: string;
  subtitle?: string;
  auraModule?: string;
  auraActions?: AuraButtonId[];
  children: React.ReactNode;
}

/** HQ chrome always renders; auth + dashboard errors stay in the content pane */
export const HqShellRoute: React.FC<HqShellRouteProps> = ({
  path,
  title = "IFCDC Headquarters",
  subtitle = "Enterprise Operating System",
  auraModule,
  auraActions,
  children,
}) => (
  <HQLayout title={title} subtitle={subtitle} auraModule={auraModule} auraActions={auraActions}>
    <HqAuthGate path={path}>
      <HqErrorBoundary>
        <Suspense fallback={<HqLoading message="Loading dashboard…" />}>
          {children}
        </Suspense>
      </HqErrorBoundary>
    </HqAuthGate>
  </HQLayout>
);
