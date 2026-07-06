import React from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { HqLoading } from "./HqLoading";
import { HqDataUnavailable } from "./HqDataUnavailable";

type QuerySlice = Pick<UseQueryResult, "isLoading" | "isError" | "error" | "refetch" | "isFetched" | "isFetching">;

export const HqQueryBoundary: React.FC<{
  query: QuerySlice;
  title?: string;
  message?: string;
  loadingMessage?: string;
  /** When true, skip the full-page loader (e.g. placeholder / empty-state data is already shown). */
  hasRenderableData?: boolean;
  children: React.ReactNode;
}> = ({ query, title, message, loadingMessage, hasRenderableData, children }) => {
  const showBlockingLoader =
    !hasRenderableData && (query.isLoading || (query.isFetching && !query.isFetched));

  if (showBlockingLoader) {
    return <HqLoading message={loadingMessage} />;
  }

  if (query.isError && query.isFetched && !hasRenderableData) {
    const detail = (query.error as Error)?.message;
    const isForbidden = detail?.includes("Access denied") || detail?.includes("403");
    return (
      <HqDataUnavailable
        title={title ?? (isForbidden ? "Access restricted" : "Live data unavailable")}
        message={
          message ??
          (isForbidden
            ? "Your account does not have permission for this module. Super Admin and Founder roles should have full access — try signing out and back in, or contact platform support."
            : "This module could not load live data from headquarters APIs.")
        }
        detail={detail}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return <>{children}</>;
};
