import assert from "node:assert/strict";
import test from "node:test";
import { compareDeployment, sameCommitPrefix } from "../server/hq/githubIntegrationEngine";
import { scoreFromFindings, type TechFinding } from "../server/hq/auraTechnicalCommandEngine";

test("sameCommitPrefix matches 7-character Render / GitHub SHAs", () => {
  assert.equal(sameCommitPrefix("978288833181e1b69198bd9dea952660d0e0e364", "9782888"), true);
  assert.equal(sameCommitPrefix("5cc71bf865e7182777753b797b9cbee8efa11a39", "9782888"), false);
});

test("compareDeployment treats merge-commit parent of live SHA as aligned", () => {
  const github = "5cc71bf865e7182777753b797b9cbee8efa11a39";
  const live = "978288833181e1b69198bd9dea952660d0e0e364";
  assert.equal(compareDeployment(github, live), "behind");
  assert.equal(
    compareDeployment(github, live, {
      githubParents: ["81bb4767d3b30dbfcaf09eac724333889ff38227", live],
    }),
    "aligned",
  );
});

test("compareDeployment treats identical git trees as aligned", () => {
  const tree = "938883e1c696112da52fa0a4efb61941f50be95e";
  assert.equal(
    compareDeployment("5cc71bf", "9782888", { githubTreeSha: tree, liveTreeSha: tree }),
    "aligned",
  );
});

test("Technical Command healthy banner requires no high-severity deploy mismatch", () => {
  const aligned: TechFinding[] = [
    {
      id: "github-ok",
      module: "github",
      title: "GitHub / deploy tracking",
      status: "ok",
      severity: "low",
      detail: "Render (9782888) matches GitHub main tree (5cc71bf)",
    },
  ];
  const shaOnlyMismatch: TechFinding[] = [
    {
      id: "deploy-behind",
      module: "render",
      title: "Render behind GitHub main",
      status: "degraded",
      severity: "high",
      detail: "Live 9782888 vs GitHub 5cc71bf",
    },
  ];
  const ok = scoreFromFindings(aligned);
  const mismatch = scoreFromFindings(shaOnlyMismatch);
  assert.equal(ok.label, "healthy");
  assert.equal(ok.score, 100);
  assert.equal(mismatch.score, 90);
  assert.equal(mismatch.label, "degraded");
});
