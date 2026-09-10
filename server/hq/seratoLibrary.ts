/**
 * AURA DJ — Serato library reader for IFCDC HQ (Founder Mac / production node).
 * Observe/read only. Does not invent BPM/key/cues.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { basename, extname, join } from "path";
import { homedir, hostname } from "os";

const AUDIO_EXT = new Set([".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a", ".aac", ".ogg"]);

function utf16BeString(buf: Buffer, start: number, byteLen: number): string {
  const end = Math.min(start + byteLen, buf.length);
  let out = "";
  for (let i = start; i + 1 < end; i += 2) {
    const code = (buf[i] << 8) | buf[i + 1];
    if (code === 0) continue;
    out += String.fromCharCode(code);
  }
  return out;
}

export function parseSeratoCrateFile(cratePath: string) {
  if (!existsSync(cratePath) || !cratePath.endsWith(".crate")) {
    return { ok: false as const, path: cratePath, tracks: [] as Array<{ path: string; exists: boolean }>, error: "not_a_crate_file" };
  }
  const buf = readFileSync(cratePath);
  const tracks: Array<{ path: string; exists: boolean }> = [];
  let i = 0;
  while (i + 8 < buf.length) {
    const tag = buf.slice(i, i + 4).toString("ascii");
    const len = buf.readUInt32BE(i + 4);
    const bodyStart = i + 8;
    const bodyEnd = bodyStart + len;
    if (bodyEnd > buf.length) break;
    if (tag === "otrk") {
      let j = bodyStart;
      while (j + 8 <= bodyEnd) {
        const inner = buf.slice(j, j + 4).toString("ascii");
        const innerLen = buf.readUInt32BE(j + 4);
        const s = j + 8;
        const e = s + innerLen;
        if (e > bodyEnd) break;
        if (inner === "ptrk") {
          let rel = utf16BeString(buf, s, innerLen).replace(/\0/g, "").trim();
          if (rel.startsWith("Users/")) rel = `/${rel}`;
          if (rel.startsWith("/")) tracks.push({ path: rel, exists: existsSync(rel) });
        }
        j = e;
      }
    }
    i = bodyEnd;
  }
  return {
    ok: true as const,
    path: cratePath,
    name: basename(cratePath, ".crate"),
    tracks,
    trackCount: tracks.length,
  };
}

function guessTitleArtist(filePath: string) {
  const base = basename(filePath, extname(filePath));
  if (base.includes(" - ")) {
    const parts = base.split(" - ");
    let artist = parts[0].replace(/^\([^)]*\)\s*/, "").trim();
    const title = parts.slice(1).join(" - ").trim();
    return { title: title || base, artist: artist || null, titleSource: "filename", artistSource: artist ? "filename" : null };
  }
  return { title: base, artist: null, titleSource: "filename", artistSource: null };
}

function probeTags(filePath: string): {
  durationSeconds: number | null;
  bpm: number | null;
  key: string | null;
  title: string | null;
  artist: string | null;
} {
  try {
    const r = spawnSync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", filePath],
      { encoding: "utf8", timeout: 8000 }
    );
    if (r.status !== 0) return { durationSeconds: null, bpm: null, key: null, title: null, artist: null };
    const json = JSON.parse(r.stdout || "{}");
    const tags = json.format?.tags || {};
    const duration = Number(json.format?.duration);
    const bpmRaw = tags.TBPM || tags.bpm || tags.BPM;
    const bpm = bpmRaw != null && Number.isFinite(Number(bpmRaw)) ? Number(bpmRaw) : null;
    return {
      durationSeconds: Number.isFinite(duration) ? Math.round(duration * 10) / 10 : null,
      bpm,
      key: tags.TKEY || tags.initialkey || tags.key || null,
      title: tags.title || tags.TITLE || null,
      artist: tags.artist || tags.ARTIST || null,
    };
  } catch {
    return { durationSeconds: null, bpm: null, key: null, title: null, artist: null };
  }
}

export function isSeratoDjProRunning(): boolean {
  try {
    const r = spawnSync("pgrep", ["-lf", "Serato DJ Pro"], { encoding: "utf8" });
    return r.status === 0 && /Serato DJ Pro/.test(String(r.stdout || ""));
  } catch {
    return false;
  }
}

function detectApps() {
  return [
    "/Applications/Serato DJ Pro.app",
    "/Applications/Serato Studio.app",
  ]
    .filter((p) => existsSync(p))
    .map((p) => ({ path: p, name: basename(p), exists: true }));
}

function detectLibraries() {
  const home = homedir();
  return [
    join(home, "Music/_Serato_"),
    join(home, "Music/_Serato_/Subcrates"),
    join(home, "Library/Application Support/Serato"),
  ]
    .filter((p) => existsSync(p))
    .map((p) => {
      let entryCount: number | null = null;
      try {
        entryCount = readdirSync(p).length;
      } catch {
        entryCount = null;
      }
      return { path: p, exists: true, entryCount };
    });
}

function listCrateFiles() {
  const root = join(homedir(), "Music/_Serato_/Subcrates");
  const crates: Array<{
    id: string;
    name: string;
    path: string;
    parent: string;
    trackCount: number;
    kind: string;
  }> = [];
  if (!existsSync(root)) return crates;
  for (const name of readdirSync(root)) {
    if (name.startsWith(".")) continue;
    const p = join(root, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isFile() && name.endsWith(".crate")) {
      const parsed = parseSeratoCrateFile(p);
      crates.push({
        id: Buffer.from(p).toString("base64url"),
        name: name.replace(/\.crate$/i, ""),
        path: p,
        parent: "Subcrates",
        trackCount: parsed.trackCount || 0,
        kind: "crate_file",
      });
    } else if (st.isDirectory()) {
      crates.push({
        id: Buffer.from(p).toString("base64url"),
        name,
        path: p,
        parent: "Subcrates",
        trackCount: 0,
        kind: "crate_folder",
      });
    }
  }
  return crates;
}

export function enrichTrack(raw: { path: string }, probe = true) {
  const guessed = guessTitleArtist(raw.path);
  const fileExists = existsSync(raw.path);
  let bytes: number | null = null;
  if (fileExists) {
    try {
      bytes = statSync(raw.path).size;
    } catch {
      bytes = null;
    }
  }
  const tags = probe && fileExists ? probeTags(raw.path) : null;
  return {
    path: raw.path,
    exists: fileExists,
    title: tags?.title || guessed.title,
    artist: tags?.artist || guessed.artist,
    titleSource: tags?.title ? "id3" : guessed.titleSource,
    artistSource: tags?.artist ? "id3" : guessed.artistSource,
    bpm: tags?.bpm ?? null,
    key: tags?.key ?? null,
    durationSeconds: tags?.durationSeconds ?? null,
    cues: null,
    stems: null,
    cleanExplicit: /clean/i.test(raw.path) ? "clean" : null,
    provenance: { cratePathEntry: raw.path, fileExists, bytes },
  };
}

export function getCrateTracks(crateId: string, opts?: { probeDuration?: boolean }) {
  let cratePath: string;
  try {
    cratePath = Buffer.from(String(crateId), "base64url").toString("utf8");
  } catch {
    return { ok: false as const, error: "invalid_crate_id" };
  }
  if (!existsSync(cratePath)) return { ok: false as const, error: "crate_not_found", cratePath };
  let raw: Array<{ path: string; exists: boolean }> = [];
  if (cratePath.endsWith(".crate")) {
    raw = parseSeratoCrateFile(cratePath).tracks || [];
  }
  const tracks = raw.map((t) => enrichTrack(t, opts?.probeDuration !== false));
  return {
    ok: true as const,
    crate: {
      id: crateId,
      name: basename(cratePath).replace(/\.crate$/i, ""),
      path: cratePath,
      trackCount: raw.length,
    },
    tracks,
    note: "BPM/key/cues null until Serato metadata parsers pass",
  };
}

export function getLiveSeratoDashboard() {
  const apps = detectApps();
  const libraries = detectLibraries();
  const crates = listCrateFiles();
  const installed = apps.some((a) => /Serato DJ Pro/i.test(a.name));
  const running = isSeratoDjProRunning();
  const libraryAccessible = libraries.length > 0;
  const totalTracks = crates.reduce((n, c) => n + (c.trackCount || 0), 0);

  return {
    ok: true,
    phase: "PHASE_1_LIBRARY_INTELLIGENCE",
    updatedAt: new Date().toISOString(),
    hostname: hostname(),
    live: {
      seratoDjProInstalled: installed ? "YES" : "NO",
      seratoDjProRunning: running ? "YES" : "NO",
      seratoLibraryAccess: libraryAccessible ? "CONNECTED" : "DISCONNECTED",
      auraSeratoBridge: "NOT_BUILT",
      controlCapability: "NOT_BUILT",
    },
    domains: {
      seratoConnection: installed ? (running ? "TESTING" : "BUILT") : "NOT_BUILT",
      libraryAccess: libraryAccessible ? "TESTING" : "NOT_BUILT",
      crateIntelligence: crates.length ? "TESTING" : "NOT_BUILT",
      trackAnalysis: totalTracks ? "TESTING" : "NOT_BUILT",
      bpmKey: "NOT_BUILT",
      cueGridIntelligence: "NOT_BUILT",
      transitionPlanning: "NOT_BUILT",
      controlBridge: "NOT_BUILT",
      stems: "NOT_BUILT",
      liveMixing: "NOT_BUILT",
      setMemory: "BUILT",
    },
    apps,
    libraries,
    crates,
    totals: { crateCount: crates.length, trackEntriesVisible: totalTracks },
  };
}

export function launchSeratoDjPro(): { ok: boolean; error?: string; running: boolean } {
  if (isSeratoDjProRunning()) return { ok: true, running: true };
  const app = "/Applications/Serato DJ Pro.app";
  if (!existsSync(app)) return { ok: false, error: "Serato DJ Pro.app not installed", running: false };
  try {
    spawnSync("open", ["-a", "Serato DJ Pro"], { encoding: "utf8", timeout: 15000 });
    return { ok: true, running: isSeratoDjProRunning() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), running: false };
  }
}

const SERATO_BRIDGE_URL = process.env.AURA_SERATO_BRIDGE_URL || "http://127.0.0.1:4179";

export async function fetchSeratoBridgeHealth(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SERATO_BRIDGE_URL}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function fetchSeratoBridgeDecks(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SERATO_BRIDGE_URL}/v1/decks`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function fetchSeratoHqSnapshot(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SERATO_BRIDGE_URL}/v1/hq/snapshot`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function postSeratoBridgeCommand(command: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${SERATO_BRIDGE_URL}/v1/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, args }),
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

async function remoteAuraDjHqFromNode(): Promise<Record<string, unknown> | null> {
  try {
    const { getPrimaryAuraMusicNodeSnapshot, AURA_MUSIC_HEARTBEAT_TIMEOUT_MS } = await import(
      "./auraMusicProductionNode"
    );
    const snap = await getPrimaryAuraMusicNodeSnapshot();
    if (!snap?.online || !snap.heartbeat) return null;
    if (typeof snap.ageMs === "number" && snap.ageMs > AURA_MUSIC_HEARTBEAT_TIMEOUT_MS) {
      return {
        ok: false,
        source: "remote_production_node_stale",
        visibility: {
          auraDj: "SERATO NODE OFFLINE",
          seratoDjPro: "SERATO OFFLINE",
          bridge: "BRIDGE DISCONNECTED",
          founderMacSeratoNode: "SERATO NODE OFFLINE",
          remoteObserver: "DISCONNECTED",
        },
        currentBlocker: "SERATO NODE OFFLINE",
        decks: { A: { title: "EMPTY", loaded: false }, B: { title: "EMPTY", loaded: false } },
        domains: {},
        live: { localNode: "OFFLINE", bridgeServiceRunning: "NO" },
        bridge: { status: "SERATO NODE OFFLINE", note: "Production node heartbeat timed out" },
        generatedAt: new Date().toISOString(),
      };
    }
    const hq = (snap.heartbeat as { auraDjHq?: Record<string, unknown> }).auraDjHq;
    if (!hq || typeof hq !== "object") return null;
    return { ...hq, source: hq.source || "remote_production_node" };
  } catch {
    return null;
  }
}

export async function getLiveSeratoDashboardMerged() {
  const base = getLiveSeratoDashboard();
  const localSnap = await fetchSeratoHqSnapshot();
  const bridge = localSnap || (await fetchSeratoBridgeHealth());

  if (bridge && (bridge.ok !== false || bridge.service === "aura-serato-bridge")) {
    const bridgeDomains = (bridge.domains || {}) as Record<string, string>;
    const bridgeLive = (bridge.live || {}) as Record<string, string>;
    const bridgeMetrics = (bridge.metrics || {}) as Record<string, unknown>;
    const visibility = (bridge.visibility || {}) as Record<string, string>;
    return {
      ...base,
      ok: true,
      source: localSnap ? "local_serato_bridge" : "local_serato_bridge_health",
      bridge: bridge.bridge || {
        service: "aura-serato-bridge",
        status: "CONNECTED",
        bind: bridge.bind,
      },
      metrics: bridgeMetrics,
      visibility: {
        auraDj: visibility.auraDj || "ONLINE",
        seratoDjPro:
          visibility.seratoDjPro ||
          (bridgeLive.seratoDjProStatus === "RUNNING" || bridgeLive.seratoDjProRunning === "YES"
            ? "RUNNING"
            : "SERATO OFFLINE"),
        bridge: visibility.bridge || "CONNECTED",
        founderMacSeratoNode: visibility.founderMacSeratoNode || "ONLINE",
        remoteObserver: visibility.remoteObserver || bridgeLive.remoteObserver || "DISCONNECTED",
      },
      progress: bridge.progress || null,
      currentBlocker: bridge.currentBlocker || bridgeLive.lastError || null,
      coreFoundation: bridge.coreFoundation || null,
      certification: bridge.certification || null,
      autonomousMode: bridge.autonomousMode || null,
      operatingModel: bridge.operatingModel || null,
      intelligence: bridge.intelligence || null,
      memory: bridge.memory || null,
      catalog: bridge.catalog || null,
      decks: bridge.decks || null,
      twoDeck: bridge.twoDeck || null,
      controlChannel: bridge.controlChannel || null,
      live: {
        ...base.live,
        ...bridgeLive,
        seratoDjProInstalled: bridgeLive.seratoDjProInstalled || base.live.seratoDjProInstalled,
        seratoDjProRunning: bridgeLive.seratoDjProRunning || base.live.seratoDjProRunning,
        seratoLibraryAccess: bridgeLive.seratoLibraryAccess || base.live.seratoLibraryAccess,
      },
      domains: {
        ...base.domains,
        seratoDjPro: bridgeDomains.seratoDjPro || base.domains.seratoDjPro,
        seratoConnection: base.domains.seratoConnection,
        libraryAccess: base.domains.libraryAccess,
        library: bridgeDomains.library || base.domains.libraryAccess,
        control: bridgeDomains.control || "TESTING",
        controlBridge: bridgeDomains.control || "TESTING",
        auraSeratoBridge: bridgeDomains.auraSeratoBridge || "BUILT",
        remoteObserver: bridgeDomains.remoteObserver || "DISCONNECTED",
        readOnlyDeckState: bridgeDomains.readOnlyDeckState || "NOT_READABLE",
        bpmKey: bridgeDomains.bpmKey || "TESTING",
        cueGridIntelligence: bridgeDomains.cueGrid || bridgeDomains.cueGridIntelligence || "TESTING",
        cueGrid: bridgeDomains.cueGrid || "TESTING",
        twoDeckState: bridgeDomains.twoDeckState || "TESTING",
        transitionPlanning: bridgeDomains.transitionIntelligence || "NOT_BUILT",
        transitionIntelligence: bridgeDomains.transitionIntelligence || "NOT_BUILT",
        liveMixing: bridgeDomains.liveMixing || "NOT_BUILT",
        setMemory: bridgeDomains.setMemory || "BUILT",
        stems: bridgeDomains.stems || "NOT_BUILT",
        transport: (bridge.progress as { currentLesson?: { id?: string; status?: string } } | null)
          ?.currentLesson?.id === "transport"
          ? String((bridge.progress as { currentLesson?: { status?: string } }).currentLesson?.status || "TESTING")
          : bridgeDomains.transport || "TESTING",
      },
      updatedAt: (bridge.generatedAt as string) || (bridge.updatedAt as string) || base.updatedAt,
    };
  }

  // Cloud HQ / non-Mac: use production-node heartbeat (same pattern as Ableton sampling).
  const remote = await remoteAuraDjHqFromNode();
  if (remote) {
    const bridgeDomains = (remote.domains || {}) as Record<string, string>;
    const bridgeLive = (remote.live || {}) as Record<string, string>;
    const visibility = (remote.visibility || {}) as Record<string, string>;
    return {
      ...base,
      ok: remote.ok !== false,
      source: remote.source || "remote_production_node",
      hostname: (remote.hostname as string) || base.hostname,
      bridge: remote.bridge || {
        service: "aura-serato-bridge",
        status: visibility.bridge || "BRIDGE DISCONNECTED",
      },
      metrics: (remote.metrics as Record<string, unknown>) || {},
      visibility,
      progress: remote.progress || null,
      currentBlocker: remote.currentBlocker || null,
      coreFoundation: remote.coreFoundation || null,
      certification: remote.certification || null,
      autonomousMode: remote.autonomousMode || null,
      operatingModel: remote.operatingModel || null,
      intelligence: remote.intelligence || null,
      memory: remote.memory || null,
      catalog: remote.catalog || null,
      decks: remote.decks || null,
      twoDeck: remote.twoDeck || null,
      controlChannel: remote.controlChannel || null,
      live: {
        ...base.live,
        ...bridgeLive,
        localNode: visibility.founderMacSeratoNode === "ONLINE" ? "ONLINE" : "OFFLINE",
      },
      domains: {
        ...base.domains,
        ...bridgeDomains,
        cueGridIntelligence: bridgeDomains.cueGrid || bridgeDomains.cueGridIntelligence || "TESTING",
        transitionPlanning: bridgeDomains.transitionIntelligence || bridgeDomains.transitionPlanning || "NOT_BUILT",
        controlBridge: bridgeDomains.control || bridgeDomains.controlBridge || "TESTING",
      },
      crates: base.crates?.length ? base.crates : [],
      message:
        visibility.founderMacSeratoNode === "SERATO NODE OFFLINE"
          ? "SERATO NODE OFFLINE"
          : visibility.bridge === "BRIDGE DISCONNECTED"
            ? "BRIDGE DISCONNECTED — live Serato from Founder Mac node"
            : "Live Serato status from Founder Mac production node",
      updatedAt: (remote.generatedAt as string) || base.updatedAt,
    };
  }

  return {
    ...base,
    bridge: {
      service: "aura-serato-bridge",
      status: "BRIDGE DISCONNECTED",
      note: "Bridge process not reachable on 127.0.0.1:4179 and no production-node Serato snapshot",
    },
    visibility: {
      auraDj: "BRIDGE DISCONNECTED",
      seratoDjPro: "SERATO OFFLINE",
      bridge: "BRIDGE DISCONNECTED",
      founderMacSeratoNode: "SERATO NODE OFFLINE",
      remoteObserver: "DISCONNECTED",
    },
    progress: null,
    currentBlocker: "SERATO NODE OFFLINE",
    decks: null,
    domains: {
      ...base.domains,
      auraSeratoBridge: "NOT_BUILT",
      controlBridge: "NOT_BUILT",
    },
    live: {
      ...base.live,
      bridgeServiceRunning: "NO",
      bridgeConnected: "NOT_CONNECTED",
      controlChannelAvailable: "NOT_BUILT",
      localNode: "OFFLINE",
    },
    message: "SERATO NODE OFFLINE",
  };
}

/** Decks for HQ — local bridge first, else last heartbeat decks. */
export async function getSeratoDecksForHq() {
  const local = await fetchSeratoBridgeDecks();
  if (local) return { ...local, source: "local_serato_bridge" };

  const remote = await remoteAuraDjHqFromNode();
  if (remote?.decks) {
    const a = remote.decks.A as Record<string, unknown> | undefined;
    const b = remote.decks.B as Record<string, unknown> | undefined;
    return {
      ok: remote.ok !== false,
      source: remote.source || "remote_production_node",
      decks: {
        A: {
          track: a
            ? {
                title: a.title,
                artist: a.artist,
                path: a.path,
              }
            : null,
          play: a?.play,
          positionSeconds: a?.positionSeconds,
          bpm: a?.bpm,
        },
        B: {
          track: b
            ? {
                title: b.title,
                artist: b.artist,
                path: b.path,
              }
            : null,
          play: b?.play,
          positionSeconds: b?.positionSeconds,
          bpm: b?.bpm,
        },
      },
      hqDecks: remote.decks,
      visibility: remote.visibility,
      message:
        (remote.visibility as { bridge?: string } | undefined)?.bridge === "BRIDGE DISCONNECTED"
          ? "BRIDGE DISCONNECTED"
          : undefined,
    };
  }

  return {
    ok: false,
    error: "serato_bridge_offline",
    visibility: {
      bridge: "BRIDGE DISCONNECTED",
      founderMacSeratoNode: "SERATO NODE OFFLINE",
      seratoDjPro: "SERATO OFFLINE",
    },
    message: "SERATO NODE OFFLINE",
  };
}
