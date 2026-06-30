import React from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { HqLoading } from "../HqLoading";
import { HqDataUnavailable } from "../HqDataUnavailable";

export const GrantQueryBoundary: React.FC<{
  query: Pick<UseQueryResult, "isLoading" | "isError" | "error" | "refetch" | "isFetched">;
  title?: string;
  message?: string;
  loadingMessage?: string;
  children: React.ReactNode;
}> = ({ query, title, message, loadingMessage, children }) => {
  if (query.isLoading) return <HqLoading message={loadingMessage} />;
  if (query.isError && query.isFetched) {
    return (
      <HqDataUnavailable
        title={title ?? "Grant data unavailable"}
        message={message ?? "This section could not load live data from headquarters."}
        detail={(query.error as Error)?.message}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <>{children}</>;
};
