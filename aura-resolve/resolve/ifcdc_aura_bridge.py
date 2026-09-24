# Runs inside DaVinci Resolve (Workspace > Scripts). Localhost only.
# External fusionscript is refused on this install, so Resolve itself hosts the API.
import json
import os
import queue
import socket
import threading
import traceback
from pathlib import Path

# When launched via Workspace > Scripts, Resolve injects resolve/fusion/bmd.
# When relaunched attached to the host (-a), recover the same objects if missing.
try:
    resolve  # noqa: F821
except NameError:
    try:
        import fusionscript as _bmd  # type: ignore
        resolve = _bmd.scriptapp("Resolve")
        fusion = _bmd.scriptapp("Fusion")
        bmd = _bmd
    except Exception:
        resolve = None
        fusion = None
        bmd = None

try:
    fusion  # noqa: F821
except NameError:
    fusion = None

try:
    bmd  # noqa: F821
except NameError:
    bmd = None

HOME = Path.home()
ROOT = HOME / "Library/Application Support/IFCDC/aura-resolve"
MEDIA = ROOT / "media"
RENDERS = ROOT / "renders"
TOKEN_PATH = ROOT / "bridge.token"
STATUS_PATH = ROOT / "status.json"
AUDIT_PATH = ROOT / "audit.jsonl"
HOST = "127.0.0.1"
PORT = 4182
PROJECT_PREFIX = "IFCDC-AURA-"

ROOT.mkdir(parents=True, exist_ok=True)
MEDIA.mkdir(parents=True, exist_ok=True)
RENDERS.mkdir(parents=True, exist_ok=True)

jobs = queue.Queue()


def audit(action, ok, detail):
    line = json.dumps({
        "action": action,
        "ok": bool(ok),
        "detail": detail,
    })
    with AUDIT_PATH.open("a") as handle:
        handle.write(line + "\n")


def allowed_path(path):
    resolved = Path(path).expanduser().resolve()
    root = ROOT.resolve()
    return str(resolved).startswith(str(root) + os.sep) or resolved == root


def project_name_ok(name):
    return isinstance(name, str) and name.startswith(PROJECT_PREFIX) and len(name) < 80


def snapshot():
    product = None
    version = None
    project = None
    timeline = None
    try:
        product = resolve.GetProductName()
        version = resolve.GetVersionString()
        manager = resolve.GetProjectManager()
        current = manager.GetCurrentProject() if manager else None
        if current:
            project = current.GetName()
            tl = current.GetCurrentTimeline()
            timeline = tl.GetName() if tl else None
    except Exception as exc:
        return {"resolve": "OFFLINE", "error": str(exc)}
    return {
        "resolve": "ONLINE",
        "product": product,
        "version": version,
        "project": project,
        "timeline": timeline,
        "page": resolve.GetCurrentPage(),
    }


def op_status(_payload):
    return snapshot()


def op_create_project(payload):
    name = payload.get("name")
    if not project_name_ok(name):
        raise ValueError("project name must start with IFCDC-AURA-")
    manager = resolve.GetProjectManager()
    current = manager.GetCurrentProject()
    if current and current.GetName() == name:
        project = current
        created = False
    else:
        names = list(manager.GetProjectListInCurrentFolder() or [])
        if name in names and current and current.GetName() != name:
            manager.SaveProject()
            manager.CloseProject(current)
        project = manager.LoadProject(name) if name in names else None
        created = False
        if not project:
            project = manager.CreateProject(name)
            created = True
        if not project:
            current = manager.GetCurrentProject()
            if current and current.GetName() == name:
                project = current
                created = False
        if not project:
            raise RuntimeError("CreateProject returned nothing. Projects here: " + ", ".join(names))
    project.SetSetting("timelineResolutionWidth", str(payload.get("width", 1280)))
    project.SetSetting("timelineResolutionHeight", str(payload.get("height", 720)))
    project.SetSetting("timelineFrameRate", str(payload.get("frameRate", "24")))
    return {"created": created, "name": project.GetName()}


def op_import_media(payload):
    path = payload.get("path")
    if not path or not allowed_path(path) or not os.path.isfile(path):
        raise ValueError("media must be an existing file inside the IFCDC resolve library")
    project = resolve.GetProjectManager().GetCurrentProject()
    if not project:
        raise RuntimeError("no current project")
    pool = project.GetMediaPool()
    storage = resolve.GetMediaStorage()
    clips = storage.AddItemListToMediaPool([path]) if storage else None
    if not clips:
        clips = pool.ImportMedia([path])
    if not clips:
        raise RuntimeError("ImportMedia returned nothing")
    clip = clips[0]
    props = clip.GetClipProperty() or {}
    return {
        "name": clip.GetName(),
        "id": clip.GetMediaId(),
        "frames": props.get("Frames"),
        "fps": props.get("FPS"),
        "resolution": props.get("Resolution"),
    }


def op_create_timeline(payload):
    name = payload.get("name") or "IFCDC-AURA-TIMELINE"
    if not str(name).startswith("IFCDC-AURA-"):
        raise ValueError("timeline name must start with IFCDC-AURA-")
    project = resolve.GetProjectManager().GetCurrentProject()
    pool = project.GetMediaPool()
    # Reuse an existing timeline with the same name when re-running a draft.
    try:
        count = int(project.GetTimelineCount() or 0)
        for index in range(1, count + 1):
            existing = project.GetTimelineByIndex(index)
            if existing and existing.GetName() == name:
                project.SetCurrentTimeline(existing)
                return {"name": existing.GetName(), "id": existing.GetUniqueId(), "created": False}
    except Exception:
        pass
    timeline = pool.CreateEmptyTimeline(name)
    if not timeline:
        # Collision or UI lock — try a unique suffix rather than failing the draft.
        alt = "%s-%s" % (name, str(int(__import__("time").time()) % 100000))
        timeline = pool.CreateEmptyTimeline(alt)
    if not timeline:
        raise RuntimeError("CreateEmptyTimeline returned nothing")
    project.SetCurrentTimeline(timeline)
    return {"name": timeline.GetName(), "id": timeline.GetUniqueId(), "created": True}


def op_add_clip(payload):
    project = resolve.GetProjectManager().GetCurrentProject()
    pool = project.GetMediaPool()
    timeline = project.GetCurrentTimeline()
    if not timeline:
        raise RuntimeError("no current timeline")
    wanted = payload.get("mediaName")
    folder = pool.GetRootFolder()
    match = None
    for clip in folder.GetClipList() or []:
        if not wanted or clip.GetName() == wanted:
            match = clip
            break
    if not match:
        raise RuntimeError("clip not found in the media pool root")
    placed = pool.AppendToTimeline([match])
    if not placed:
        raise RuntimeError("AppendToTimeline returned nothing")
    item = placed[0]
    return {
        "name": item.GetName(),
        "start": item.GetStart(),
        "end": item.GetEnd(),
        "duration": item.GetDuration(),
    }


def op_save(_payload):
    ok = resolve.GetProjectManager().SaveProject()
    if not ok:
        raise RuntimeError("SaveProject returned false")
    return {"saved": True}


def op_render(payload):
    target = payload.get("targetDir") or str(RENDERS)
    if not allowed_path(target):
        raise ValueError("render directory must stay inside the IFCDC resolve library")
    Path(target).mkdir(parents=True, exist_ok=True)
    project = resolve.GetProjectManager().GetCurrentProject()
    if not project.GetCurrentTimeline():
        raise RuntimeError("no current timeline")
    custom = payload.get("name") or "IFCDC-AURA-BRIDGE-TEST"
    project.SetCurrentRenderFormatAndCodec("mp4", "H264")
    project.SetCurrentRenderMode(1)
    settings = {
        "SelectAllFrames": True,
        "TargetDir": target,
        "CustomName": custom,
        "ExportVideo": True,
        "ExportAudio": True,
        "FormatWidth": int(payload.get("width", 1280)),
        "FormatHeight": int(payload.get("height", 720)),
    }
    if not project.SetRenderSettings(settings):
        raise RuntimeError("SetRenderSettings returned false")
    job_id = project.AddRenderJob()
    if not job_id:
        raise RuntimeError("AddRenderJob returned nothing")
    if not project.StartRendering(job_id):
        raise RuntimeError("StartRendering returned false")
    return {"jobId": job_id, "targetDir": target, "name": custom}


def op_render_status(payload):
    project = resolve.GetProjectManager().GetCurrentProject()
    job_id = payload.get("jobId")
    status = project.GetRenderJobStatus(job_id) if job_id else {}
    return {
        "rendering": bool(project.IsRenderingInProgress()),
        "status": status,
    }


def guarded_project():
    project = resolve.GetProjectManager().GetCurrentProject()
    if not project or not str(project.GetName() or "").startswith(PROJECT_PREFIX):
        raise RuntimeError("edit commands stay inside an IFCDC-AURA project")
    timeline = project.GetCurrentTimeline()
    if not timeline:
        raise RuntimeError("no current timeline")
    return project, project.GetMediaPool(), timeline


def find_timeline_item(timeline, name):
    for track_type in ("video", "audio", "subtitle"):
        count = timeline.GetTrackCount(track_type) or 0
        for index in range(1, count + 1):
            for item in timeline.GetItemListInTrack(track_type, index) or []:
                if not name or item.GetName() == name:
                    return item, track_type, index
    return None, None, None


def find_pool_clip(pool, name):
    for clip in pool.GetRootFolder().GetClipList() or []:
        if clip.GetName() == name:
            return clip
    return None


def op_trim_clip(payload):
    _project, pool, timeline = guarded_project()
    item, _track_type, _index = find_timeline_item(timeline, payload.get("mediaName"))
    if not item:
        raise RuntimeError("clip not on the timeline")
    source = item.GetMediaPoolItem() or find_pool_clip(pool, item.GetName())
    if not source:
        raise RuntimeError("source media was not found")
    start = int(payload.get("startFrame", item.GetSourceStartFrame() or 0))
    end = int(payload.get("endFrame", item.GetSourceEndFrame() or start))
    record = int(payload.get("recordFrame", item.GetStart()))
    if not timeline.DeleteClips([item], False):
        raise RuntimeError("could not lift the clip for trim")
    placed = pool.AppendToTimeline([{
        "mediaPoolItem": source,
        "startFrame": start,
        "endFrame": end,
        "recordFrame": record,
    }])
    if not placed:
        raise RuntimeError("trim replacement was not placed")
    return {"name": placed[0].GetName(), "start": placed[0].GetStart(), "end": placed[0].GetEnd()}


def op_split_clip(payload):
    _project, pool, timeline = guarded_project()
    item, _track_type, _index = find_timeline_item(timeline, payload.get("mediaName"))
    if not item:
        raise RuntimeError("clip not on the timeline")
    source = item.GetMediaPoolItem()
    if not source:
        raise RuntimeError("source media was not found")
    split_at = int(payload["frame"])
    src_start = int(item.GetSourceStartFrame() or 0)
    src_end = int(item.GetSourceEndFrame() or split_at)
    record = int(item.GetStart())
    offset = split_at - record
    if offset <= 0 or split_at >= int(item.GetEnd()):
        raise RuntimeError("split frame is outside the clip")
    if not timeline.DeleteClips([item], False):
        raise RuntimeError("could not lift the clip for split")
    pieces = pool.AppendToTimeline([
        {"mediaPoolItem": source, "startFrame": src_start, "endFrame": src_start + offset, "recordFrame": record},
        {"mediaPoolItem": source, "startFrame": src_start + offset, "endFrame": src_end, "recordFrame": split_at},
    ])
    if not pieces or len(pieces) < 2:
        raise RuntimeError("split did not place both pieces")
    return {"pieces": [{"name": piece.GetName(), "start": piece.GetStart(), "end": piece.GetEnd()} for piece in pieces]}


def op_move_clip(payload):
    _project, pool, timeline = guarded_project()
    item, _track_type, _index = find_timeline_item(timeline, payload.get("mediaName"))
    if not item:
        raise RuntimeError("clip not on the timeline")
    source = item.GetMediaPoolItem()
    record = int(payload["recordFrame"])
    info = {
        "mediaPoolItem": source,
        "startFrame": int(item.GetSourceStartFrame() or 0),
        "endFrame": int(item.GetSourceEndFrame() or 0),
        "recordFrame": record,
    }
    if not timeline.DeleteClips([item], False):
        raise RuntimeError("could not lift the clip to move it")
    placed = pool.AppendToTimeline([info])
    if not placed:
        raise RuntimeError("moved clip was not placed")
    return {"name": placed[0].GetName(), "start": placed[0].GetStart(), "end": placed[0].GetEnd()}


def _try_set_title_text(item, text):
    if not text:
        return False
    try:
        comp = item.GetFusionCompByIndex(1) if hasattr(item, "GetFusionCompByIndex") else None
        if comp:
            tools = list(comp.GetToolList().values()) if hasattr(comp, "GetToolList") else []
            for tool in tools:
                try:
                    if hasattr(tool, "SetInput"):
                        tool.SetInput("StyledText", str(text)[:120])
                        return True
                except Exception:
                    continue
        if hasattr(item, "SetProperty"):
            item.SetProperty("Text", str(text)[:120])
            return True
    except Exception:
        return False
    return False


def op_add_title(payload):
    _project, _pool, timeline = guarded_project()
    title = payload.get("titleName") or "Text"
    item = timeline.InsertTitleIntoTimeline(title) or timeline.InsertFusionTitleIntoTimeline(title)
    if not item:
        raise RuntimeError("title was not inserted")
    text = payload.get("titleText") or payload.get("text")
    text_set = _try_set_title_text(item, text)
    return {
        "name": item.GetName(),
        "start": item.GetStart(),
        "end": item.GetEnd(),
        "text": text,
        "textSet": bool(text_set),
        "applied": True,
    }


def op_add_logo(payload):
    imported = op_import_media({"path": payload.get("path")})
    placed = op_add_clip({"mediaName": imported["name"]})
    return {"imported": imported, "placed": placed, "applied": True}


def op_add_music(payload):
    return _place_audio(payload, "music")


def op_add_voiceover(payload):
    return _place_audio(payload, "voiceover")


def _place_audio(payload, role):
    imported = op_import_media({"path": payload.get("path")})
    project, pool, timeline = guarded_project()
    clip = find_pool_clip(pool, imported["name"])
    if not clip:
        raise RuntimeError("audio did not enter the media pool")
    timeline.AddTrack("audio", "stereo")
    track_index = timeline.GetTrackCount("audio")
    placed = pool.AppendToTimeline([{
        "mediaPoolItem": clip,
        "mediaType": 2,
        "trackIndex": track_index,
    }])
    if not placed:
        raise RuntimeError(role + " was not placed")
    return {"role": role, "name": placed[0].GetName(), "track": track_index}


def op_adjust_audio_levels(payload):
    _project, _pool, timeline = guarded_project()
    item, track_type, index = find_timeline_item(timeline, payload.get("mediaName"))
    if not item or track_type != "audio":
        raise RuntimeError("audio clip not on the timeline")
    note = "level " + str(payload.get("db")) + " dB"
    timeline.AddMarker(item.GetStart(), "Green", "AURA level", note, 1)
    return {"applied": False, "noted": True, "track": index, "note": note, "reason": "Fairlight fader writes are not in this Resolve scripting API"}


def op_mark_fade(payload):
    """Prefer placing generated fade media so the render actually darkens."""
    media_name = payload.get("mediaName")
    if media_name:
        placed = op_add_clip({"mediaName": media_name})
        return {"applied": True, "visibleEffect": True, "kind": payload.get("kind") or "video", "placed": placed, "method": "generated-fade-clip"}
    path = payload.get("path")
    if path:
        imported = op_import_media({"path": path})
        placed = op_add_clip({"mediaName": imported["name"]})
        return {"applied": True, "visibleEffect": True, "kind": payload.get("kind") or "video", "placed": placed, "method": "imported-fade-clip"}
    _project, _pool, timeline = guarded_project()
    kind = payload.get("kind") or "video"
    frame = int(payload.get("frame", timeline.GetEndFrame() - 24))
    timeline.AddMarker(frame, "Yellow", "AURA fade " + kind, "No fade media supplied. Keyframe fades are not in this Resolve API.", 1)
    return {"applied": False, "noted": True, "kind": kind, "frame": frame, "reason": "Provide mediaName/path for a visible fade"}


def op_add_subtitles(payload):
    _project, _pool, timeline = guarded_project()
    lines = payload.get("lines") or []
    timeline.AddTrack("subtitle")
    if lines:
        # Visible stand-in: insert a title card with caption text (subtitle track APIs are limited).
        title = op_add_title({"titleName": "Text", "titleText": " | ".join(str(line) for line in lines)[:80]})
        timeline.AddMarker(timeline.GetStartFrame(), "Blue", "AURA captions", " | ".join(str(line) for line in lines)[:500], 1)
        return {"applied": True, "visibleEffect": True, "lines": len(lines), "title": title, "method": "title-as-caption"}
    ok = timeline.CreateSubtitlesFromAudio({})
    return {"applied": bool(ok), "fromAudio": True}


def op_add_transition(payload):
    """Native dissolve insert is unavailable; place a visible brand-flash clip when provided."""
    media_name = payload.get("mediaName")
    if media_name:
        placed = op_add_clip({"mediaName": media_name})
        return {"applied": True, "visibleEffect": True, "kind": payload.get("kind") or "brand-flash", "placed": placed, "method": "generated-transition-clip"}
    path = payload.get("path")
    if path:
        imported = op_import_media({"path": path})
        placed = op_add_clip({"mediaName": imported["name"]})
        return {"applied": True, "visibleEffect": True, "kind": payload.get("kind") or "brand-flash", "placed": placed, "method": "imported-transition-clip"}
    _project, _pool, timeline = guarded_project()
    timeline.AddMarker(int(payload.get("frame", timeline.GetStartFrame())), "Pink", "AURA transition", str(payload.get("kind") or "cross dissolve"), 1)
    return {"applied": False, "noted": True, "reason": "Resolve scripting has no transition insert; supply mediaName for a visible flash"}


def op_apply_branding(payload):
    notes = []
    logo = payload.get("logoPath")
    placed = None
    if logo:
        placed = op_add_logo({"path": logo})
        notes.append("logo")
    title = op_add_title({
        "titleName": payload.get("titleName") or "Text",
        "titleText": payload.get("titleText") or "IFCDC",
    })
    notes.append("title")
    return {"notes": notes, "title": title, "logo": placed, "publish": False, "applied": True}


def op_create_bin(payload):
    project = resolve.GetProjectManager().GetCurrentProject()
    if not project:
        raise RuntimeError("no current project")
    pool = project.GetMediaPool()
    root = pool.GetRootFolder()
    name = payload.get("name") or "IFCDC-AURA-BIN"
    if not str(name).startswith("IFCDC-AURA-"):
        raise ValueError("bin name must start with IFCDC-AURA-")
    for child in root.GetSubFolderList() or []:
        if child.GetName() == name:
            return {"name": name, "created": False, "applied": True}
    folder = pool.AddSubFolder(root, name)
    if not folder:
        # Some Resolve pages refuse subfolder creation; draft can continue in the root.
        return {"name": name, "created": False, "applied": False, "reason": "AddSubFolder unavailable on this page; using root"}
    return {"name": folder.GetName(), "created": True, "applied": True}


def op_remove_clip(payload):
    _project, _pool, timeline = guarded_project()
    item, _track_type, _index = find_timeline_item(timeline, payload.get("mediaName"))
    if not item:
        raise RuntimeError("clip not on the timeline")
    if not timeline.DeleteClips([item], False):
        raise RuntimeError("DeleteClips returned false")
    return {"removed": payload.get("mediaName"), "applied": True}


def op_duplicate_clip(payload):
    placed = op_add_clip({"mediaName": payload.get("mediaName")})
    return {"duplicated": True, "placed": placed, "applied": True}


def op_set_clip_duration(payload):
    # Closest real edit: trim end frame to approximate duration.
    frames = int(payload.get("frames") or payload.get("durationFrames") or 0)
    if frames <= 0:
        raise ValueError("frames required")
    return op_trim_clip({
        "mediaName": payload.get("mediaName"),
        "startFrame": int(payload.get("startFrame") or 0),
        "endFrame": int(payload.get("startFrame") or 0) + frames,
        "recordFrame": payload.get("recordFrame"),
    })


def op_reorder_clips(payload):
    # Honest limitation: full reorder requires lift/replace of every item.
    order = payload.get("order") or []
    _project, _pool, timeline = guarded_project()
    timeline.AddMarker(timeline.GetStartFrame(), "Cyan", "AURA reorder", "Requested order: " + ",".join(str(x) for x in order)[:400], 1)
    return {"applied": False, "noted": True, "reason": "Use move_clip per item for concrete reorders"}


def op_basic_cleanup(payload):
    project, _pool, timeline = guarded_project()
    # Light real cleanup: ensure current timeline is selected and project settings stick.
    project.SetCurrentTimeline(timeline)
    return {"applied": True, "timeline": timeline.GetName(), "note": "timeline re-selected"}


OPS = {
    "status": op_status,
    "create_project": op_create_project,
    "import_media": op_import_media,
    "create_bin": op_create_bin,
    "create_timeline": op_create_timeline,
    "add_clip": op_add_clip,
    "trim_clip": op_trim_clip,
    "split_clip": op_split_clip,
    "move_clip": op_move_clip,
    "remove_clip": op_remove_clip,
    "duplicate_clip": op_duplicate_clip,
    "set_clip_duration": op_set_clip_duration,
    "reorder_clips": op_reorder_clips,
    "add_transition": op_add_transition,
    "add_title": op_add_title,
    "add_logo": op_add_logo,
    "add_music": op_add_music,
    "add_voiceover": op_add_voiceover,
    "adjust_audio_levels": op_adjust_audio_levels,
    "fade_audio": op_mark_fade,
    "fade_video": op_mark_fade,
    "add_subtitles": op_add_subtitles,
    "apply_branding": op_apply_branding,
    "basic_cleanup": op_basic_cleanup,
    "save_project": op_save,
    "render": op_render,
    "render_status": op_render_status,
}


def dispatch(message):
    action = message.get("action")
    token = message.get("token")
    expected = TOKEN_PATH.read_text().strip() if TOKEN_PATH.exists() else ""
    if not expected or token != expected:
        raise PermissionError("bridge token rejected")
    if action not in OPS:
        raise PermissionError("operation is not allowlisted")
    result = OPS[action](message.get("payload") or {})
    audit(action, True, "ok")
    return {"ok": True, "action": action, "result": result}


def serve(connection):
    raw = b""
    try:
        while b"\n" not in raw and len(raw) < 100000:
            chunk = connection.recv(8192)
            if not chunk:
                break
            raw += chunk
        message = json.loads(raw.decode("utf-8") or "{}")
        try:
            body = dispatch(message)
        except Exception as exc:
            audit(message.get("action"), False, str(exc))
            body = {"ok": False, "error": str(exc)}
        connection.sendall((json.dumps(body) + "\n").encode("utf-8"))
    except Exception as exc:
        try:
            connection.sendall((json.dumps({"ok": False, "error": str(exc)}) + "\n").encode("utf-8"))
        except Exception:
            pass
    finally:
        connection.close()


def listen():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind((HOST, PORT))
        server.listen(8)
        (ROOT / "bridge-listen.txt").write_text(f"bound {HOST}:{PORT}\n")
    except Exception:
        (ROOT / "bridge-listen.txt").write_text(traceback.format_exc())
        return
    server.settimeout(0.5)
    while True:
        try:
            connection, _addr = server.accept()
        except socket.timeout:
            continue
        except Exception:
            break
        threading.Thread(target=serve, args=(connection,), daemon=True).start()


def drain(_ev=None):
    try:
        while True:
            jobs.get_nowait()()
    except queue.Empty:
        pass


STATE = {"listener": False, "error": None}
try:
    threading.Thread(target=listen, daemon=True).start()
    STATE["listener"] = True
except Exception as exc:
    STATE["error"] = traceback.format_exc()
    audit("listen", False, str(exc))

STATUS_PATH.write_text(json.dumps({
    "bridge": "ONLINE" if STATE["listener"] else "OFFLINE",
    "insideResolve": True,
    "listener": "127.0.0.1:4182" if STATE["listener"] else None,
    "error": STATE["error"],
    "resolve": snapshot(),
}, indent=2))

def keep_alive():
    import time
    while True:
        time.sleep(0.25)


try:
    ui = fusion.UIManager
    dispatcher = bmd.UIDispatcher(ui)
    window_id = "com.ifcdc.aura.resolve.bridge"
    existing = ui.FindWindow(window_id)
    if existing:
        existing.Show()
        existing.Raise()
        keep_alive()
    else:
        win = dispatcher.AddWindow({
            "ID": window_id,
            "WindowTitle": "IFCDC AURA Resolve Bridge",
            "Geometry": [80, 80, 420, 140],
        }, [
            ui.Label({"ID": "Status", "Text": "Listening on 127.0.0.1:4182. Local commands only."}),
        ])

        def on_close(_ev):
            dispatcher.ExitLoop()

        win.On[window_id].Close = on_close
        win.Show()
        dispatcher.RunLoop()
        win.Hide()
except Exception:
    (ROOT / "bridge-ui-error.txt").write_text(traceback.format_exc())
    keep_alive()
