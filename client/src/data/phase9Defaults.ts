/** Phase 9 must render within 5s — fail fast and show empty-state UI. */
export const PHASE9_FETCH_TIMEOUT_MS = 5_000;

export type Phase9Package = {
  phase: number;
  platform: string;
  commandCenter: {
    briefing: {
      greeting: string;
      highlights: string[];
      priorities: string[];
    };
    organizationHealth: { overall: number; grade: string };
    recommendations: { action: string; priority: string; module?: string }[];
    riskAlerts: { title: string; detail: string; severity: string }[];
  };
  divisions: {
    counts: { total: number; healthy: number; productionLocked: number };
    dataLayer: {
      divisions: { name: string; status: string; healthy: boolean; dataSource: string }[];
    };
  };
  workflows: {
    pending: number;
    overdue: number;
    escalations: { title: string }[];
  };
  notifications: { unreadCount: number; highPriority: number };
  reporting: {
    oneClickReports: { id: string; label: string; path?: string }[];
  };
  generatedAt: string;
};

export const EMPTY_PHASE9_PACKAGE: Phase9Package = {
  phase: 9,
  platform: "IFCDC Intelligent Operating System",
  commandCenter: {
    briefing: {
      greeting: "Executive Command",
      highlights: [],
      priorities: [],
    },
    organizationHealth: { overall: 0, grade: "—" },
    recommendations: [],
    riskAlerts: [],
  },
  divisions: {
    counts: { total: 0, healthy: 0, productionLocked: 0 },
    dataLayer: { divisions: [] },
  },
  workflows: { pending: 0, overdue: 0, escalations: [] },
  notifications: { unreadCount: 0, highPriority: 0 },
  reporting: { oneClickReports: [] },
  generatedAt: new Date().toISOString(),
};

export const EMPTY_PHASE9_PREDICTIVE = {
  models: [] as {
    id: string;
    label: string;
    current: number;
    projected30d: number;
    trend: string;
    unit: string;
  }[],
  generatedAt: new Date().toISOString(),
};

/** Merge partial API payloads — never returns nested fields that crash the UI. */
export function normalizePhase9Package(
  raw: Partial<Phase9Package> | Record<string, unknown> | null | undefined
): Phase9Package {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_PHASE9_PACKAGE, generatedAt: new Date().toISOString() };
  }
  const e = EMPTY_PHASE9_PACKAGE;
  const cc = (raw.commandCenter ?? {}) as Partial<Phase9Package["commandCenter"]>;
  const briefing = (cc.briefing ?? {}) as Partial<Phase9Package["commandCenter"]["briefing"]>;
  const divs = (raw.divisions ?? {}) as Partial<Phase9Package["divisions"]>;
  const dataLayer = (divs.dataLayer ?? {}) as Partial<Phase9Package["divisions"]["dataLayer"]>;
  const wf = (raw.workflows ?? {}) as Partial<Phase9Package["workflows"]>;
  const notifs = (raw.notifications ?? {}) as Partial<Phase9Package["notifications"]>;
  const reporting = (raw.reporting ?? {}) as Partial<Phase9Package["reporting"]>;

  return {
    phase: typeof raw.phase === "number" ? raw.phase : e.phase,
    platform: typeof raw.platform === "string" ? raw.platform : e.platform,
    commandCenter: {
      briefing: {
        greeting: briefing.greeting ?? e.commandCenter.briefing.greeting,
        highlights: briefing.highlights ?? [],
        priorities: briefing.priorities ?? [],
      },
      organizationHealth: cc.organizationHealth ?? e.commandCenter.organizationHealth,
      recommendations: cc.recommendations ?? [],
      riskAlerts: cc.riskAlerts ?? [],
    },
    divisions: {
      counts: divs.counts ?? e.divisions.counts,
      dataLayer: {
        divisions: dataLayer.divisions ?? [],
      },
    },
    workflows: {
      pending: wf.pending ?? 0,
      overdue: wf.overdue ?? 0,
      escalations: wf.escalations ?? [],
    },
    notifications: {
      unreadCount: notifs.unreadCount ?? 0,
      highPriority: notifs.highPriority ?? 0,
    },
    reporting: {
      oneClickReports: reporting.oneClickReports ?? [],
    },
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date().toISOString(),
  };
}
