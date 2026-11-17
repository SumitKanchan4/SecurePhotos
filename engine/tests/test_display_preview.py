"""A8 (owner: loading should be smooth): the viewer's 2560 px preview, and the start-up
thumbnail pass that no longer rebuilds thumbnails that are already good."""

import secrets
import shutil

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.api import photos as photos_api
from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services import display_preview
from engine.services.media_paths import resolve_stored_path, to_db_path


def _photo(path, size, orientation=None):
    img = Image.new("RGB", size, (30, 90, 160))
    img.paste((220, 40, 40), (0, 0, size[0] // 4, size[1] // 4))  # Top-left marker.
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    img.save(path, "JPEG", quality=90, exif=exif.tobytes())


def test_a_big_photo_gets_an_upright_2560_preview_and_a_small_one_none(tmp_path):
    big, small = tmp_path / "big.jpg", tmp_path / "small.jpg"
    _photo(big, (4000, 3000), orientation=6)  # Stored sideways; shown turned.
    _photo(small, (1600, 1200))
    before = big.read_bytes()
    dest = tmp_path / "prev" / "p.webp"
    assert display_preview.make_preview(big, dest)
    with Image.open(dest) as im:
        assert im.format == "WEBP" and im.size == (1920, 2560)  # Upright, 2560 on the long side.
    assert big.read_bytes() == before  # The photo is never changed.
    assert not display_preview.make_preview(small, tmp_path / "prev" / "s.webp")
    assert not (tmp_path / "prev" / "s.webp").exists()


@pytest.fixture
async def lib():
    await run_migrations()
    folder = settings.data_dir / "originals" / f"a8_{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    ids = []
    conn = await get_db_connection()
    try:
        for name, size, encrypted in (("big.jpg", (4000, 3000), 0), ("small.jpg", (1600, 1200), 0), ("vault.jpg", (4000, 3000), 1)):
            _photo(folder / name, size)
            cur = await conn.execute(
                "INSERT INTO photos (filename, filepath, file_size, mime_type, width, height, file_hash, is_encrypted) "
                "VALUES (?, ?, 1, 'image/jpeg', ?, ?, ?, ?);",
                (name, to_db_path(folder / name), size[0], size[1], secrets.token_hex(8), encrypted),
            )
            ids.append(cur.lastrowid)
        await conn.commit()
        yield {"conn": conn, "ids": ids, "folder": folder}
    finally:
        await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(ids))});", ids)
        await conn.commit()
        await conn.close()
        shutil.rmtree(folder, ignore_errors=True)
        shutil.rmtree(settings.previews_dir / "display", ignore_errors=True)


async def _preview_path(conn, photo_id):
    async with conn.execute("SELECT preview_path FROM photos WHERE id = ?;", (photo_id,)) as cur:
        return (await cur.fetchone())[0]


async def test_the_viewer_gets_a_preview_made_once_and_recorded(lib):
    conn, (big, small, vault) = lib["conn"], lib["ids"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.get(f"/api/photos/{big}/preview")
        stored = await _preview_path(conn, big)
        again = await client.get(f"/api/photos/{big}/preview")
        small_res = await client.get(f"/api/photos/{small}/preview")
        vault_res = await client.get(f"/api/photos/{vault}/preview")
    assert first.status_code == 200 and first.headers["content-type"] == "image/webp"
    assert stored and resolve_stored_path(stored).is_file()
    assert again.content == first.content
    assert small_res.status_code == 200 and small_res.headers["content-type"] == "image/jpeg"  # Shown as it is.
    assert await _preview_path(conn, small) is None
    assert vault_res.status_code == 403 and await _preview_path(conn, vault) is None  # Never a plain copy.


def test_start_up_thumbnail_pass_keeps_good_thumbnails(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path, raising=False)
    good, tiny, small_photo = tmp_path / "good.webp", tmp_path / "tiny.webp", tmp_path / "small.webp"
    Image.new("RGB", (1024, 768)).save(good, "WEBP")
    Image.new("RGB", (512, 384)).save(tiny, "WEBP")
    Image.new("RGB", (800, 600)).save(small_photo, "WEBP")
    current = photos_api._thumbnail_is_current
    assert current(str(good), "image/avif", 7680)
    assert not current(str(tiny), "image/avif", 7680)  # Old 512 px thumbnail: rebuilt once.
    assert current(str(small_photo), "image/jpeg", 800)  # The photo itself is that small.
    assert not current(str(tmp_path / "missing.webp"), "image/jpeg", 4000)
    assert not current(None, "image/jpeg", 4000)
    assert current(str(tiny), "video/mp4", 0)  # A video's thumbnail just has to exist.
