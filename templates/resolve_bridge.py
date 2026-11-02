"""Optional Resolve scripting bridge. Import only; rendering requires explicit approval."""

import argparse
import importlib
import json
import os
from pathlib import Path
import sys


def connect():
    api = os.environ.get("RESOLVE_SCRIPT_API")
    if api:
        sys.path.insert(0, str(Path(api) / "Modules"))
    try:
        module = importlib.import_module("DaVinciResolveScript")
    except ImportError as error:
        raise RuntimeError(
            "Resolve scripting module unavailable. Install Python and configure "
            "RESOLVE_SCRIPT_API/RESOLVE_SCRIPT_LIB using Resolve's installed Developer "
            "Scripting README. External scripting may require Studio; use manual XML "
            "import with Free."
        ) from error
    resolve = module.scriptapp("Resolve")
    if not resolve:
        raise RuntimeError("Cannot connect to Resolve. Open Resolve and check scripting permissions/edition.")
    return resolve


def require(value, message):
    if not value:
        raise RuntimeError(message)
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--render-current", action="store_true")
    parser.add_argument("--handoff", type=Path)
    parser.add_argument("--project-name")
    parser.add_argument("--render-preset")
    parser.add_argument("--render-dir", type=Path)
    parser.add_argument("--approve-render", action="store_true")
    parser.add_argument("--start-render", action="store_true")
    args = parser.parse_args(argv)
    if args.probe and (args.render_current or args.handoff or args.render_preset or
                       args.render_dir or args.approve_render or args.start_render):
        parser.error("--probe cannot be combined with import/render actions")
    if not args.probe:
        if not args.project_name:
            parser.error("--project-name is required")
        if args.render_current and args.handoff:
            parser.error("--render-current cannot be combined with --handoff")
        if not args.render_current and not args.handoff:
            parser.error("--handoff is required for importing into a NEW project")
        if bool(args.render_preset) != bool(args.render_dir):
            parser.error("--render-preset and --render-dir must be supplied together")
        if args.render_preset and not args.approve_render:
            parser.error("Rendering requires --approve-render after picture/audio/captions/color review")
        if args.start_render and not args.render_preset:
            parser.error("--start-render requires an approved render preset and directory")
        if bool(args.render_preset) != args.render_current:
            parser.error("Rendering must be a separate --render-current action after manual finishing")
        if not args.render_current:
            root = args.handoff.resolve(strict=True)
            timeline_file = (root / "timeline.xml").resolve(strict=True)
            bundle = json.loads((root / "bundle.json").read_text(encoding="utf-8"))
            if bundle.get("version") != 1:
                raise RuntimeError("Unsupported handoff version")
    resolve = connect()
    if args.probe:
        print(json.dumps({"connected": True, "version": resolve.GetVersionString()}))
        return
    manager = require(resolve.GetProjectManager(), "Project manager unavailable")
    if args.render_current:
        project = require(manager.GetCurrentProject(), "No current project")
        require(project.GetName() == args.project_name, "Current project name does not match approval")
        require(project.GetCurrentTimeline(), "No current timeline")
    else:
        project = require(
            manager.CreateProject(args.project_name),
            "Cannot create project; choose a NEW name. Existing projects are never opened or replaced.",
        )
        for key, value in {
            "timelineFrameRate": bundle["plan"]["fps"],
            "timelineResolutionWidth": bundle["plan"]["width"],
            "timelineResolutionHeight": bundle["plan"]["height"],
        }.items():
            require(project.SetSetting(key, str(value)), f"Cannot set {key}")
        timeline = require(
            project.GetMediaPool().ImportTimelineFromFile(str(timeline_file)),
            "Resolve rejected XML timeline. Inspect media paths and try manual import.",
        )
        require(project.SetCurrentTimeline(timeline), "Cannot select imported timeline")
        require(manager.SaveProject(), "Cannot save imported project")
        print("Imported PICTURE-ONLY draft. Sync audio, import SRT, and finish color/graphics manually.")
    if args.render_preset:
        output = args.render_dir.resolve()
        if not output.is_dir():
            raise RuntimeError("Render directory must already exist")
        if any(output.iterdir()):
            raise RuntimeError("Use an EMPTY render directory to avoid overwriting existing output")
        require(project.SetCurrentRenderMode(1), "Cannot select single-clip render mode")
        require(project.LoadRenderPreset(args.render_preset), "Render preset not found")
        require(
            project.SetRenderSettings({
                "TargetDir": str(output), "CustomName": args.project_name, "SelectAllFrames": True
            }), "Cannot apply render settings",
        )
        job = require(project.AddRenderJob(), "Cannot queue render job")
        require(manager.SaveProject(), "Cannot save render configuration")
        print(f"Queued render job: {job}. StartRendering is not called without --start-render.")
        if args.start_render:
            require(project.StartRendering(job), "Resolve could not start the render job")
            print("Render started, NOT verified complete. Monitor Resolve and inspect the resulting file.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f"video-monk Resolve bridge: {error}", file=sys.stderr)
        sys.exit(1)
