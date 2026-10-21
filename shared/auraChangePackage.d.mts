export type ChangePackage = {
  version: 1; repository: "IFCDC9/IFCDC"; baseCommit: string; summary: string;
  files: { path: string; beforeSha256: string | null; content: string }[];
};
export type ChangePackageReview = {
  packageSha256: string; repository: string; baseCommit: string; summary: string;
  files: { path: string; operation: string; beforeSha256: string | null; afterSha256: string; bytes: number }[];
  testsRun: false; productionExecuted: false;
};
export function validateChangePackage(input: unknown): ChangePackage;
export function reviewChangePackage(input: unknown): ChangePackageReview;
