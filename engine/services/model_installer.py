"""Downloads the old-photo models while SecurePhotos is being installed or upgraded (H10 / A2c).

The installer runs ``securephotos-engine.exe --fetch-models`` after it has copied the app
(``src-tauri/nsis-hooks.nsh``). For each model:

- already in place and matching its SHA-256 -> skipped ("already up to date");
- otherwise downloaded from the pinned address and checked (an interrupted download
  continues from where it stopped next time);
- if that fails (offline, not published yet), the app asks later; the install still succeeds.

Progress (T19, owner 2026-11-21) goes to ``install_progress.txt`` in the models folder: line 1
the overall percentage, line 2 a plain line such as "Add colour (1 of 5): 450 of 980 MB". The
installer reads it while the download runs and moves its own progress bar. At the end the short
summary goes to ``install_status.txt``; the installer shows it in its window (T21), and the file
appearing tells it the download is over. The exit code is always 0 so the install never fails
because of a download.
"""

import sys
import threading
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional

from engine.services import ai_models

# Plain names for the installer's status lines (no file names or model jargon).
MODEL_NAMES: Dict[str, str] = {
    "ddcolor_large": "Add colour",
    "ddcolor_artistic": "Add colour (second pass)",
    "gfpgan": "Sharpen faces",
    "scratch_detector": "Remove scratches (finding them)",
    "lama": "Remove scratches (filling in)",
}

READY, UP_TO_DATE, FAILED = "ready", "already up to date", "couldn't download (the app will ask later)"
STATUS_FILE = "install_status.txt"
PROGRESS_FILE = "install_progress.txt"


def progress_line(name: str, number: int, count: int, done: int, total: int) -> str:
    """"Add colour (1 of 5): 450 of 980 MB" for the installer's status line."""
    return f"{name} ({number} of {count}): {done / 1e6:,.0f} of {total / 1e6:,.0f} MB"


def fetch_models(
    dest_dir: Path,
    say: Callable[[str], None] = print,
    cancel: Optional[threading.Event] = None,
    also_check: Optional[List[Path]] = None,
    report: Optional[Callable[[int, str], None]] = None,
) -> Dict[str, str]:
    """Makes sure every old-photo model is in ``dest_dir`` (or already verified in one of
    ``also_check``, e.g. a library kept on another drive). Returns {key: status}.

    ``report(percent, line)`` gets the overall progress (all models' bytes) as it goes.
    """
    results: Dict[str, str] = {}
    keys = list(ai_models.ON_DEMAND_MODELS)
    all_bytes = sum(int(ai_models.ON_DEMAND_MODELS[k]["size"]) for k in keys) or 1
    finished_bytes = 0
    for number, key in enumerate(keys, start=1):
        name = MODEL_NAMES.get(key, key)
        spec = ai_models.ON_DEMAND_MODELS[key]
        if any(ai_models.is_model_ready(key, folder) for folder in [dest_dir, *(also_check or [])]):
            results[key] = UP_TO_DATE
            say(f"{name}: {UP_TO_DATE}")
            finished_bytes += int(spec["size"])
            if report:
                report(int(finished_bytes * 100 / all_bytes), f"{name} ({number} of {len(keys)}): {UP_TO_DATE}")
            continue
        size_gb = int(spec["size"]) / 1e9
        say(f"Downloading {name} ({number} of {len(keys)}, {size_gb:.1f} GB)...")
        last = [-1]

        def progress(done: int, total: int, _name: str = name, _number: int = number, _before: int = finished_bytes) -> None:
            step = int(done * 10 / total) * 10 if total else 0
            if step != last[0] and step < 100:
                last[0] = step
                say(f"  {_name}: {step}%")
            if report:
                report(int((_before + done) * 100 / all_bytes), progress_line(_name, _number, len(keys), done, total or int(spec["size"])))

        try:
            ai_models.fetch_on_demand(key, dest_dir, progress, cancel)
            results[key] = READY
            say(f"{name}: {READY}")
        except Exception as err:  # Offline, release not public yet, bad checksum.
            results[key] = FAILED
            say(f"{name}: {FAILED}")
            say(f"  ({type(err).__name__}: {str(err)[:160]})")
        finished_bytes += int(spec["size"])
    if report:
        report(100, "Old-photo models: done")
    return results


def summary(results: Dict[str, str]) -> List[str]:
    """The lines the installer shows at the end."""
    lines = [f"{MODEL_NAMES.get(k, k)}: {v}" for k, v in results.items()]
    if any(v == FAILED for v in results.values()):
        lines.append("")
        lines.append("Everything else works now. The app will offer the download when you first use one of these.")
    return lines


def main(argv: Optional[List[str]] = None) -> int:
    """``--fetch-models [folder]``: the folder defaults to the app's own ``data/models``."""
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "--fetch-models":
        argv = argv[1:]
    dest = Path(argv[0]) if argv else ai_models.get_bundled_models_dir()

    def say(line: str) -> None:
        print(line, flush=True)

    say("Getting the old-photo models (about 2.7 GB, once).")
    last_write = [0.0]

    def report(percent: int, line: str) -> None:
        # At most a few times a second; the installer checks about twice a second.
        now = time.monotonic()
        if percent < 100 and now - last_write[0] < 0.3:
            return
        last_write[0] = now
        try:
            dest.mkdir(parents=True, exist_ok=True)
            text = f"{max(0, min(100, percent))}\r\n{line}\r\n"
            (dest / PROGRESS_FILE).write_bytes(text.encode("utf-8"))
        except OSError:
            pass

    try:
        library = [ai_models.get_models_dir()]  # Honours data_location.txt next to the app.
    except Exception:
        library = []
    try:
        results = fetch_models(dest, say, also_check=library, report=report)
    except Exception as err:  # Never fail the install.
        say(f"Model check stopped: {type(err).__name__}")
        results = {k: FAILED for k in ai_models.ON_DEMAND_MODELS}
    lines = summary(results)
    try:
        dest.mkdir(parents=True, exist_ok=True)
        # CRLF: the installer pastes these lines into a Windows message box as they are.
        (dest / STATUS_FILE).write_bytes(("\r\n".join(lines) + "\r\n").encode("utf-8"))
    except OSError:
        pass
    for line in lines:
        say(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
