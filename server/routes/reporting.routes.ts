import { Router } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  getReportCatalog,
  generateIrs990Report,
  generateFunderGrantReport,
  generateFunderPipelineReport,
  generateStateAnnualReport,
  generateStateCharitableReport,
  generateInternalManagementReport,
  generateInternalFinanceReport,
  generateBoardPackageReport,
  generateAnnualOrganizationalReport,
} from "../hq/enterpriseReporting";

const router = Router();

router.use(hqAuthRequired, requireHQModule("analytics"));

router.get("/catalog", async (_req, res) => {
  res.json(getReportCatalog());
});

router.get("/irs/990", async (_req, res) => {
  res.json(await generateIrs990Report());
});

router.get("/funder/grant", async (req, res) => {
  res.json(await generateFunderGrantReport(req.query.awardId as string | undefined));
});

router.get("/funder/pipeline", async (_req, res) => {
  res.json(await generateFunderPipelineReport());
});

router.get("/state/annual", async (_req, res) => {
  res.json(await generateStateAnnualReport());
});

router.get("/state/charitable", async (_req, res) => {
  res.json(await generateStateCharitableReport());
});

router.get("/internal/management", async (_req, res) => {
  res.json(await generateInternalManagementReport());
});

router.get("/internal/finance", async (_req, res) => {
  res.json(await generateInternalFinanceReport());
});

router.get("/board/package", async (_req, res) => {
  res.json(await generateBoardPackageReport());
});

router.get("/annual/organizational", async (_req, res) => {
  res.json(await generateAnnualOrganizationalReport());
});

export default router;
