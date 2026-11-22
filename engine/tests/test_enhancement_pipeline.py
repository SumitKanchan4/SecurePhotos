"""Tests for the single-version AVIF enhancement pipeline (backlog item C1)."""

import shutil

import piexif
import pytest
from PIL import Image

from engine.api import photos
from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.services.enhancement_service import enhance_to_avif, slider_to_avif_quality
from engine.services.media_paths import to_db_path


@pytest.fixture
def work_dir():
    folder = settings.data_dir / "originals" / "c1_tests"
    folder.mkdir(parents=True, exist_ok=True)
    yield folder
    shutil.rmtree(folder, ignore_errors=True)


def _jpeg_with_exif(path, size, orientation=1):
    """Writes a JPEG with camera make, GPS and an orientation tag."""
    exif = piexif.dump({
        "0th": {piexif.ImageIFD.Make: b"TestCam", piexif.ImageIFD.Orientation: orientation},
        "GPS": {piexif.GPSIFD.GPSLatitudeRef: b"N", piexif.GPSIFD.GPSLatitude: ((12, 1), (30, 1), (0, 1))},
    })
    img = Image.new("RGB", size, (90, 140, 200))
    img.paste((250, 30, 30), (0, 0, size[0] // 4, size[1] // 4))  # Marker in the top-left corner.
    img.save(path, "JPEG", quality=92, exif=exif)


def test_slider_maps_to_avif_quality():
    assert slider_to_avif_quality(12) == 92
    assert slider_to_avif_quality(18) == 80
    assert slider_to_avif_quality(28) == 60
    assert slider_to_avif_quality(5) == 92 and slider_to_avif_quality(99) == 60
    assert slider_to_avif_quality("garbage") == 80


def test_avif_keeps_camera_details_and_is_upright(work_dir):
    """Rotated phone photo: pixels turned upright, orientation reset, camera + GPS kept."""
    src = work_dir / "rotated.jpg"
    _jpeg_with_exif(src, (4000, 3000), orientation=6)  # 6 = "rotate 90° clockwise to view"
    src_bytes = src.read_bytes()

    result = enhance_to_avif(src, 80)

    assert result.path == work_dir / "rotated.avif"
    assert src.read_bytes() == src_bytes  # Source untouched; the caller deletes it later.
    with Image.open(result.path) as out:
        assert out.format == "AVIF"
        assert out.size == (5760, 7680)  # Upright: portrait, at the default 8K size.
        exif = out.getexif()
        assert exif.get(0x010F) == "TestCam"  # Make
        # Orientation is "normal" (Pillow's AVIF writer drops a normal tag), so viewers don't rotate again.
        assert exif.get(0x0112) in (None, 1)
        assert exif.get_ifd(0x8825)  # GPS block kept.
        # The red top-left marker of the stored landscape pixels must appear top-right when upright.
        w, h = out.size
        r, _, b = out.convert("RGB").getpixel((w - 10, 10))
        assert r > 200 and b < 100


def test_auto_gives_full_size_photos_8k_and_smaller_ones_4k(work_dir):
    """T26 (owner, 2026-11-21): Auto, the default. A WhatsApp-sized photo (1600x1200, 1.9 MP) gets
    4K, not 8K; a phone original (4000x3000, 12 MP) and a scan (3500x2333, 8.2 MP) get 8K."""
    from engine.services.enhancement_service import photo_size_to_long_edge

    for name, size, expected in (
        ("whatsapp", (1600, 1200), (3840, 2880)),
        ("phone", (4000, 3000), (7680, 5760)),
        ("scan", (3500, 2333), (7680, 5119)),
    ):
        src = work_dir / f"auto_{name}.jpg"
        _jpeg_with_exif(src, size)
        result = enhance_to_avif(src, 80, photo_size_to_long_edge("auto"))
        assert (result.width, result.height) == expected, name


@pytest.mark.parametrize("size,expected", [("2k", (2560, 1920)), ("4k", (3840, 2880)), ("8k", (7680, 5760)), ("auto", (7680, 5760)), ("nonsense", (7680, 5760))])
def test_photo_size_setting_is_the_size_photos_get(work_dir, size, expected):
    """Owner, 2026-11-19: Settings → Photo size (2K, 4K, 8K). A phone-sized photo (4000 px) is
    enlarged to 8K (before, 3840 px and up were only sharpened) or reduced to 2K / 4K."""
    from engine.services.enhancement_service import photo_size_to_long_edge

    src = work_dir / f"phone_{size}.jpg"
    _jpeg_with_exif(src, (4000, 3000))
    result = enhance_to_avif(src, 80, photo_size_to_long_edge(size))
    assert (result.width, result.height) == expected


def test_never_overwrites_an_existing_avif(work_dir):
    src = work_dir / "clash.jpg"
    _jpeg_with_exif(src, (1000, 800))
    other = work_dir / "clash.avif"
    other.write_bytes(b"another photo")
    result = enhance_to_avif(src, 80)
    assert result.path.name == "clash (1).avif"
    assert other.read_bytes() == b"another photo"


def test_an_improved_copys_ai_label_survives_8k(work_dir):
    """P2: improved copies get 8K too (owner D3); their IPTC 'made with AI' label must stay."""
    from engine.services.photo_versions import SOURCE_TYPE_AI, xmp_packet

    src = work_dir / "copy.avif"
    Image.new("RGB", (1200, 900), (120, 90, 60)).save(src, "AVIF", quality=80, xmp=xmp_packet(SOURCE_TYPE_AI))
    result = enhance_to_avif(src, 80)
    with Image.open(result.path) as out:
        assert b"compositeWithTrainedAlgorithmicMedia" in out.info["xmp"]


async def test_8k_waits_for_the_earlier_after_import_steps(work_dir, monkeypatch):
    """P2: a photo is enhanced only once its text is read, its faces found, the old-photo rules
    have looked at it and no old-photo job is open for it; improved copies go first."""
    monkeypatch.setattr(photos, "_running_on_battery", lambda: False)
    conn = await get_db_connection()
    ids = {}
    try:
        await conn.execute("UPDATE photos SET is_optimized = 1;")  # Only this test's photos.
        for name, cols in (
            ("ready.jpg", {}),
            ("text_unread.jpg", {"ocr_text": None}),
            ("faces_waiting.jpg", {"faces_scanned": 0}),
            ("document.jpg", {"faces_scanned": 0, "is_document": 1}),  # No faces on documents (D1).
            ("rules_waiting.jpg", {"restore_checked": 0}),
            ("job_open.jpg", {}),
        ):
            ids[name] = await _insert_photo(conn, work_dir / name, **cols)
        ids["copy.jpg"] = await _insert_photo(conn, work_dir / "copy.jpg", restore_checked=0, derived_from_id=ids["ready.jpg"])
        await conn.execute(
            "INSERT INTO restore_jobs (photo_id, kind, status, origin) VALUES (?, 'colour', 'queued', 'auto');", (ids["job_open.jpg"],)
        )
        await conn.commit()
        picked, skipped = [], set()
        while (row := await photos._next_to_enhance(skipped)) is not None:
            picked.append(row["filename"])
            skipped.add(row["id"])
        assert picked == ["document.jpg", "copy.jpg", "ready.jpg"]  # Quick wins first: plain photo, then copy, then original.
    finally:
        await conn.execute(f"DELETE FROM restore_jobs WHERE photo_id IN ({','.join('?' * len(ids))});", list(ids.values()))
        await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(ids))});", list(ids.values()))
        await conn.commit()
        await conn.close()


async def _insert_photo(conn, path, **cols):
    fields = {"filename": path.name, "filepath": to_db_path(path), "file_size": path.stat().st_size if path.exists() else 1,
              "mime_type": "image/jpeg", "file_hash": "abc123",
              # After-import steps before 8K are done (text read, faces found, old-photo rules).
              "ocr_text": "", "faces_scanned": 1, "restore_checked": 1, **cols}
    keys = ",".join(fields)
    cur = await conn.execute(f"INSERT INTO photos ({keys}) VALUES ({','.join('?' * len(fields))});", list(fields.values()))
    await conn.commit()
    return cur.lastrowid


async def _row(photo_id):
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT * FROM photos WHERE id = ?;", (photo_id,)) as cur:
            return await cur.fetchone()
    finally:
        await conn.close()


async def _delete(photo_ids):
    conn = await get_db_connection()
    try:
        await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(photo_ids))});", photo_ids)
        await conn.commit()
    finally:
        await conn.close()


@pytest.mark.real_optimizer
async def test_optimizer_replaces_photo_with_avif(work_dir, monkeypatch):
    """End to end: a relative-path import is found, enhanced, and replaced by an AVIF."""
    monkeypatch.setattr(photos, "_running_on_battery", lambda: False)
    src = work_dir / "trip.jpg"
    _jpeg_with_exif(src, (1200, 900))
    conn = await get_db_connection()
    try:
        photo_id = await _insert_photo(conn, src, original_file_hash="baseline-hash")
        # Only this photo should be processed by the run.
        await conn.execute("UPDATE photos SET is_optimized = 1 WHERE id != ?;", (photo_id,))
        await conn.commit()
    finally:
        await conn.close()

    try:
        await photos.run_background_optimization()
        row = await _row(photo_id)
        assert row["filepath"] == "originals/c1_tests/trip.avif"
        assert row["filename"] == "trip.avif" and row["mime_type"] == "image/avif"
        assert row["is_optimized"] == 1 and row["is_enhanced"] == 1
        assert (row["width"], row["height"]) == (3840, 2880)  # 1200x900 is small: Auto gives it 4K (T26)
        assert row["original_file_hash"] == "baseline-hash"  # Kept for duplicate detection.
        assert row["file_hash"] != "abc123"
        assert not src.exists() and (work_dir / "trip.avif").exists()
    finally:
        await _delete([photo_id])


@pytest.mark.real_optimizer
async def test_missing_file_is_retried_not_marked(work_dir, monkeypatch):
    """A photo whose drive is asleep/unplugged must not be marked done without enhancement."""
    monkeypatch.setattr(photos, "_running_on_battery", lambda: False)
    conn = await get_db_connection()
    try:
        photo_id = await _insert_photo(conn, work_dir / "not_there.jpg")
        await conn.execute("UPDATE photos SET is_optimized = 1 WHERE id != ?;", (photo_id,))
        await conn.commit()
    finally:
        await conn.close()
    try:
        await photos.run_background_optimization()
        assert (await _row(photo_id))["is_optimized"] == 0
    finally:
        await _delete([photo_id])


async def test_battery_guard_pauses_then_resumes(monkeypatch):
    readings = iter([True, True, False])
    seen = []
    monkeypatch.setattr(photos, "BATTERY_RECHECK_SECONDS", 0)
    monkeypatch.setattr(photos, "_running_on_battery", lambda: next(readings))
    monkeypatch.setattr(photos, "_battery_percent", lambda: 12.0)  # Below the default 20%.

    real_sleep = photos.asyncio.sleep

    async def spy_sleep(seconds):
        seen.append(photos.optimization_state["paused_reason"])
        await real_sleep(0)

    monkeypatch.setattr(photos.asyncio, "sleep", spy_sleep)
    await photos._wait_while_on_battery()
    assert seen == ["on_battery", "on_battery"]
    assert photos.optimization_state["paused_reason"] is None


async def test_battery_guard_off_never_pauses(monkeypatch):
    monkeypatch.setattr(photos, "_running_on_battery", lambda: True)

    async def guard_off():
        return {"pause_on_battery": False}

    monkeypatch.setattr(photos, "_load_enhancement_settings", guard_off)
    await photos._wait_while_on_battery()  # Returns immediately; would hang otherwise.
    assert photos.optimization_state["paused_reason"] is None


@pytest.mark.parametrize(
    ("plugged_in", "percent", "below", "guard_on", "waits"),
    [
        (False, 19.0, 20, True, True),     # Low battery: waits.
        (False, 20.0, 20, True, False),    # At the level: runs.
        (False, 85.0, 20, True, False),    # Plenty of charge: runs.
        (False, 85.0, 100, True, True),    # "Whenever on battery".
        (False, None, 20, True, True),     # Charge unknown: safe side.
        (True, 5.0, 20, True, False),      # Plugged in: always runs.
        (False, 5.0, 20, False, False),    # Guard off: never waits.
        (False, 25.0, "junk", True, False),  # A bad stored value falls back to 20%.
    ],
)
def test_battery_guard_uses_charge_level(monkeypatch, plugged_in, percent, below, guard_on, waits):
    monkeypatch.setattr(photos, "_running_on_battery", lambda: not plugged_in)
    monkeypatch.setattr(photos, "_battery_percent", lambda: percent)
    settings = {"pause_on_battery": guard_on, "battery_pause_below": below}
    assert photos.battery_guard_applies(settings) is waits


def test_battery_guard_defaults_to_twenty_percent(monkeypatch):
    monkeypatch.setattr(photos, "_running_on_battery", lambda: True)
    monkeypatch.setattr(photos, "_battery_percent", lambda: 21.0)
    assert photos.battery_guard_applies({}) is False
    monkeypatch.setattr(photos, "_battery_percent", lambda: 19.0)
    assert photos.battery_guard_applies({}) is True


async def test_requeue_migration_runs_exactly_once(work_dir):
    conn = await get_db_connection()
    try:
        await conn.execute("DELETE FROM applied_migrations WHERE name = '2026_11_c1_requeue_skipped_enhancement';")
        first = await _insert_photo(conn, work_dir / "skipped.jpg", is_optimized=1, is_enhanced=0)
        unreadable_later = None
    finally:
        await conn.close()
    try:
        await run_migrations()
        assert (await _row(first))["is_optimized"] == 0  # Re-queued.

        conn = await get_db_connection()
        try:
            unreadable_later = await _insert_photo(conn, work_dir / "bad.jpg", is_optimized=1, is_enhanced=0)
        finally:
            await conn.close()
        await run_migrations()
        assert (await _row(unreadable_later))["is_optimized"] == 1  # Not re-queued again.
    finally:
        await _delete([i for i in (first, unreadable_later) if i])


async def test_8k_leaves_a_photo_that_changed_while_it_waited(work_dir, monkeypatch):
    """2026-11-19: a photo picked before waiting for the heavy slot was already enhanced by then."""
    from engine.services import cpu_budget, enhancement_service

    await run_migrations()
    src = work_dir / "done_meanwhile.jpg"
    _jpeg_with_exif(src, (800, 600))
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, is_optimized) VALUES ('done_meanwhile.jpg', ?, 1, 'image/jpeg', 1);",
            (to_db_path(src),),
        )
        photo_id = cur.lastrowid
        await conn.commit()
    finally:
        await conn.close()

    def must_not_run(*_args, **_kwargs):
        raise AssertionError("an already-enhanced photo was enhanced again")

    monkeypatch.setattr(enhancement_service, "enhance_to_avif", must_not_run)
    row = {"id": photo_id, "filename": "done_meanwhile.jpg", "filepath": to_db_path(src)}
    try:
        await photos._enhance_one(row, src, cpu_budget, enhancement_service, None, to_db_path, None)
    finally:
        conn = await get_db_connection()
        await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
        await conn.commit()
        await conn.close()
