"""Improved copies of old photos, linked to their originals (H10 / A2b).

An improved photo (colour added, faded colours fixed, faces sharpened, scratches removed) is
a photo of its own, linked to the photo it came from by ``derived_from_id``. Owner rules
(2026-11-16):

- **Same details as the original**, so the two sit side by side: date taken, place, camera,
  title/caption, favourite, albums, document folders and named faces are copied. The
  improved photo sorts directly after its original (:data:`PAIR_ORDER`).
- **Vault photos stay in the vault:** the improved copy of a vault photo is created encrypted,
  with its sealed details re-sealed for the new photo. Nothing is written in plain form.
- **Keep both / Replace / Discard** after the user has seen the result. "Replace" (and the
  automatic rule with "Keep original" off) moves the original to Trash for 30 days, still
  linked, so "Restore original" can bring it back. Nothing is deleted on the spot.
- **One photo, not two, in People and Stories:** an original with a live improved copy is left
  out there (:func:`not_superseded`); the duplicate finder never pairs a photo with its own copy.
- **Labelled as AI:** the file carries IPTC ``DigitalSourceType`` in XMP and the original's
  EXIF, so exported copies say they were made with AI.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import aiosqlite
from PIL import Image, ImageFilter, ImageOps

from engine.services.media_paths import ENC_SUFFIX, resolve_stored_path, to_db_path, unique_path

logger = logging.getLogger("securephotos.photo_versions")

KIND_ORDER = ("fade", "colour", "scratches", "faces")
SOURCE_TYPE_AI = "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia"
SOURCE_TYPE_ENHANCED = "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced"
EXIF_ORIENTATION_TAG = 0x0112

# Timeline order inside one date: original first, then its improved copies (newest last).
PAIR_ORDER = "COALESCE({a}derived_from_id, {a}id) DESC, ({a}derived_from_id IS NOT NULL), {a}id"

COPIED_COLUMNS = (
    "taken_at", "camera_make", "camera_model", "latitude", "longitude", "iso", "aperture",
    "shutter_speed", "focal_length", "is_favorite", "caption", "content_tags", "folder_name",
    "is_document", "volume_uuid", "is_encrypted", "vault_type", "is_enhanced",
    "ocr_text", "document_source",  # After-import P2: the copy's text needn't be read again.
)


class VersionError(Exception):
    """The improved copy could not be made or kept; nothing was changed."""


def pair_order(alias: str = "") -> str:
    """:data:`PAIR_ORDER` for a query that names the photos table ``alias``."""
    return PAIR_ORDER.format(a=f"{alias}." if alias else "")


def not_superseded(alias: str = "p") -> str:
    """SQL condition: this photo has no improved copy outside Trash (so the pair counts once)."""
    return f"NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = {alias}.id AND v.trashed_at IS NULL)"


def stack_top(alias: str = "") -> str:
    """SQL condition (A8): the one tile a photo group shows in the library.

    An original with an improved copy outside Trash is hidden behind it, and of several
    copies only the newest shows. The viewer's Original / Improved switch reaches the rest.
    """
    a = f"{alias}." if alias else "photos."
    return (
        "NOT EXISTS (SELECT 1 FROM photos stk WHERE stk.trashed_at IS NULL AND ("
        f"stk.derived_from_id = {a}id OR ({a}derived_from_id IS NOT NULL "
        f"AND stk.derived_from_id = {a}derived_from_id AND stk.id > {a}id)))"
    )


CHOICES = ("keep_improved", "keep_both", "keep_original")


async def pending_choices(conn: aiosqlite.Connection, limit: int = 200) -> List[Dict[str, Any]]:
    """Improved copies kept automatically whose owner hasn't chosen yet (newest first).

    Only pairs where both photos are still in the library; vault photos are never listed.
    """
    async with conn.execute(
        """
        SELECT c.id, c.derived_from_id, c.ai_kind FROM photos c
        JOIN photos o ON o.id = c.derived_from_id
        WHERE c.choice_pending = 1 AND c.trashed_at IS NULL AND o.trashed_at IS NULL
          AND COALESCE(c.is_encrypted, 0) = 0
        ORDER BY c.id DESC LIMIT ?;
        """,
        (limit,),
    ) as cur:
        return [{"photo_id": r[0], "original_id": r[1], "ai_kind": r[2]} for r in await cur.fetchall()]


async def count_pending_choices(conn: aiosqlite.Connection) -> int:
    async with conn.execute(
        """
        SELECT COUNT(*) FROM photos c JOIN photos o ON o.id = c.derived_from_id
        WHERE c.choice_pending = 1 AND c.trashed_at IS NULL AND o.trashed_at IS NULL
          AND COALESCE(c.is_encrypted, 0) = 0;
        """
    ) as cur:
        return int((await cur.fetchone())[0])


async def choose(conn: aiosqlite.Connection, copy_ids: Sequence[int], choice: str) -> int:
    """The user's choice for improved copies (A8). Returns how many pairs it applied to.

    - ``keep_improved``: the original goes to Trash (30 days; "Restore original" brings it back).
    - ``keep_both``: both stay (one tile in the library, the original behind the improved one).
    - ``keep_original``: the improved copy goes to Trash.

    Raises:
        ValueError: Unknown choice.
    """
    if choice not in CHOICES:
        raise ValueError(f"Unknown choice {choice!r}")
    done = 0
    for copy_id in dict.fromkeys(int(i) for i in copy_ids):
        row = await _row(conn, copy_id)
        if row is None or row["derived_from_id"] is None or row["trashed_at"] is not None:
            continue
        if choice == "keep_improved":
            await trash_photo(conn, row["derived_from_id"])
        elif choice == "keep_original":
            await trash_photo(conn, copy_id)
        await conn.execute("UPDATE photos SET choice_pending = 0 WHERE id = ?;", (copy_id,))
        done += 1
    await conn.commit()
    return done


def merged_kinds(previous: Optional[str], kind: str) -> str:
    """'colour' + 'faces' -> 'colour,faces' (fixed order, no repeats); ``kind`` may itself be
    a list ('fade,faces': a faded-colour fix whose faces were sharpened)."""
    kinds = set(filter(None, (previous or "").split(","))) | set(filter(None, kind.split(",")))
    return ",".join(k for k in KIND_ORDER if k in kinds)


def source_type_for(kinds: str) -> str:
    """IPTC digital source type: the plain colour fix is an enhancement; everything else is AI-made."""
    return SOURCE_TYPE_ENHANCED if kinds == "fade" else SOURCE_TYPE_AI


def xmp_packet(source_type: str) -> bytes:
    return (
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" '
        f'Iptc4xmpExt:DigitalSourceType="{source_type}"/>'
        '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
    ).encode("utf-8")


def encode_version(result: bytes, source: bytes, kinds: str, avif_quality: int) -> Tuple[bytes, int, int]:
    """Encodes the improved pixels as AVIF with the source photo's EXIF, colour profile and an AI label.

    Args:
        result: The improved image as an encoded file (any format Pillow reads).
        source: The photo it was made from (its EXIF and colour profile are kept).
        kinds: Merged improvement kinds, for the label.
        avif_quality: From the Settings quality slider.

    Returns:
        (AVIF bytes, width, height); decoded once to verify.
    """
    with Image.open(io.BytesIO(source)) as src:
        exif = src.getexif()
        icc = src.info.get("icc_profile")
    if EXIF_ORIENTATION_TAG in exif:
        exif[EXIF_ORIENTATION_TAG] = 1  # The result's pixels are already upright.
    with Image.open(io.BytesIO(result)) as im:
        pixels = ImageOps.exif_transpose(im).convert("RGB")
    kwargs: Dict[str, Any] = {"quality": avif_quality, "xmp": xmp_packet(source_type_for(kinds))}
    if len(exif):
        kwargs["exif"] = exif.tobytes()
    if icc:
        kwargs["icc_profile"] = icc
    buffer = io.BytesIO()
    pixels.save(buffer, "AVIF", **kwargs)
    data = buffer.getvalue()
    with Image.open(io.BytesIO(data)) as check:
        check.load()
        if check.size != pixels.size:
            raise VersionError("The improved photo failed its check after saving.")
    return data, pixels.width, pixels.height


def thumbnail_webp(data: bytes, size: int = 1024) -> bytes:
    """Grid thumbnail made in memory (same look as ``generate_micro_thumbnail``)."""
    with Image.open(io.BytesIO(data)) as im:
        img = ImageOps.exif_transpose(im).convert("RGB")
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=115, threshold=3))
    out = io.BytesIO()
    img.save(out, "WEBP", quality=88, method=4)
    return out.getvalue()


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def read_photo_bytes(stored_path: str, encrypted: bool, key: Optional[bytes]) -> bytes:
    """A photo's file contents; vault photos are decrypted in memory only."""
    path = resolve_stored_path(stored_path)
    if path is None:
        raise VersionError("The photo's file is missing.")
    if encrypted:
        if key is None:
            raise VersionError("vault_locked")
        from engine.services.crypto_vault import decrypt_file_to_bytes

        return decrypt_file_to_bytes(path, key)
    return path.read_bytes()


async def _avif_quality() -> int:
    from engine.api.system import get_app_settings
    from engine.services.enhancement_service import DEFAULT_QUALITY_SLIDER, slider_to_avif_quality

    settings = (await get_app_settings())["settings"]
    return slider_to_avif_quality(settings.get("quality_crf", DEFAULT_QUALITY_SLIDER))


async def _row(conn: aiosqlite.Connection, photo_id: int) -> Optional[aiosqlite.Row]:
    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT * FROM photos WHERE id = ?;", (photo_id,)) as cur:
        return await cur.fetchone()


def _write_files(src: aiosqlite.Row, avif: bytes, file_hash: str, kind: str, key: Optional[bytes]) -> Tuple[Path, Path]:
    """Writes the improved file and its thumbnail next to the source (encrypted for vault photos)."""
    from engine.services.thumbnail_service import get_sharded_thumbnail_path

    src_path = resolve_stored_path(src["filepath"])
    if src_path is None:
        raise VersionError("The photo's file is missing.")
    plain_name = f"{Path(src['filename']).stem}_{kind}.avif"
    thumb = thumbnail_webp(avif)
    if src["is_encrypted"]:
        from engine.services.crypto_vault import encrypt_file_chunked
        from engine.services.vault_storage import _sha256_decrypted

        dest = unique_path(src_path.with_name(plain_name + ENC_SUFFIX))
        thumb_dest = get_sharded_thumbnail_path(file_hash, is_encrypted=True)
        try:
            encrypt_file_chunked(avif, dest, key)
            if _sha256_decrypted(dest, key) != file_hash:
                raise VersionError("The encrypted copy failed its check.")
            encrypt_file_chunked(thumb, thumb_dest, key)
        except BaseException:
            dest.unlink(missing_ok=True)
            thumb_dest.unlink(missing_ok=True)
            raise
        return dest, thumb_dest
    dest = unique_path(src_path.with_name(plain_name))
    thumb_dest = get_sharded_thumbnail_path(file_hash, is_encrypted=False)
    try:
        _write_atomic(dest, avif)
        _write_atomic(thumb_dest, thumb)
    except BaseException:
        dest.unlink(missing_ok=True)
        thumb_dest.unlink(missing_ok=True)
        raise
    return dest, thumb_dest


async def create_version(
    conn: aiosqlite.Connection,
    source_id: int,
    result: bytes,
    kind: str,
    params: Optional[Dict[str, Any]] = None,
    key: Optional[bytes] = None,
) -> int:
    """Adds the improved photo next to ``source_id`` and returns its id.

    The link points at the first original (improving an improved photo links to the same
    original), and the kinds add up ('colour' then 'faces' -> 'colour,faces').

    Raises:
        VersionError: Source missing or in a locked vault, or the file failed its checks.
    """
    src = await _row(conn, source_id)
    if src is None:
        raise VersionError("The photo no longer exists.")
    encrypted = bool(src["is_encrypted"])
    if encrypted and key is None:
        raise VersionError("vault_locked")
    root_id = src["derived_from_id"] or src["id"]
    kinds = merged_kinds(src["ai_kind"], kind)

    source_bytes = await asyncio.to_thread(read_photo_bytes, src["filepath"], encrypted, key)
    avif, width, height = await asyncio.to_thread(encode_version, result, source_bytes, kinds, await _avif_quality())
    del source_bytes
    file_hash = hashlib.sha256(avif).hexdigest()
    dest, thumb_dest = await asyncio.to_thread(_write_files, src, avif, file_hash, kind, key if encrypted else None)
    phash = None
    if not encrypted:
        from engine.services.duplicate_service import compute_image_dhash

        phash = await asyncio.to_thread(compute_image_dhash, dest)

    copied = {c: src[c] for c in COPIED_COLUMNS}
    columns = (
        "filename", "filepath", "file_size", "original_file_size", "mime_type", "width", "height",
        "original_width", "original_height", "thumbnail_path", "file_hash", "original_file_hash", "phash",
        "is_managed", "is_optimized", "faces_scanned", "derived_from_id", "ai_kind", "ai_params", "edited_at",
        *copied,
    )
    values = (
        f"{Path(src['filename']).stem}_{kind}.avif", to_db_path(dest), len(avif), len(avif), "image/avif",
        width, height, width, height, to_db_path(thumb_dest), file_hash, file_hash, phash,
        # is_optimized: a library copy gets 8K like its original (owner D3; the vault enhancer
        # handles vault copies as before).
        1, 1 if encrypted else 0, 0 if encrypted else 1, root_id, kinds, json.dumps(params or {}, sort_keys=True), None,
        *copied.values(),
    )
    try:
        cur = await conn.execute(
            f"INSERT INTO photos ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))});",
            values,
        )
        new_id = cur.lastrowid
        await conn.execute("UPDATE photos SET edited_at = CURRENT_TIMESTAMP WHERE id = ?;", (new_id,))
        await conn.execute(
            "INSERT OR IGNORE INTO photo_album (photo_id, album_id, added_at) "
            "SELECT ?, album_id, added_at FROM photo_album WHERE photo_id = ?;",  # Same date: sits beside the original.
            (new_id, source_id),
        )
        await conn.execute(
            "INSERT OR IGNORE INTO photo_document_folder (photo_id, folder_id) SELECT ?, folder_id FROM photo_document_folder WHERE photo_id = ?;",
            (new_id, source_id),
        )
        if encrypted and src["vault_meta_enc"]:
            from engine.services.crypto_vault import decrypt_photo_metadata, encrypt_photo_metadata

            details = decrypt_photo_metadata(src["vault_meta_enc"], key, source_id)  # Sealed per photo id.
            await conn.execute(
                "UPDATE photos SET vault_meta_enc = ? WHERE id = ?;",
                (encrypt_photo_metadata(details, key, new_id), new_id),
            )
        crops = [] if encrypted else await _copy_faces(conn, source_id, new_id)
        await conn.commit()
    except BaseException:
        await conn.rollback()
        dest.unlink(missing_ok=True)
        thumb_dest.unlink(missing_ok=True)
        raise
    for old_crop, new_crop in crops:
        try:
            if old_crop.is_file():
                await asyncio.to_thread(new_crop.write_bytes, old_crop.read_bytes())
        except OSError as err:  # A missing avatar is redrawn by the face scan; not worth failing for.
            logger.warning("Could not copy face crop %s: %s", old_crop.name, err)
    logger.info("Photo %s: improved copy %s (%s)", source_id, new_id, kinds)
    return new_id


async def _copy_faces(conn: aiosqlite.Connection, source_id: int, new_id: int) -> List[Tuple[Path, Path]]:
    """Copies the source's faces (same places, same names) to the new photo; returns crop files to copy."""
    from engine.services.face_recognition_service import get_face_thumbnails_dir

    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT * FROM faces WHERE photo_id = ?;", (source_id,)) as cur:
        faces = await cur.fetchall()
    folder = get_face_thumbnails_dir()
    crops = []
    for face in faces:
        cols = [c for c in face.keys() if c not in ("id", "photo_id", "is_anchor_medoid")]
        cur = await conn.execute(
            f"INSERT INTO faces (photo_id, {', '.join(cols)}) VALUES (?, {', '.join('?' * len(cols))});",
            (new_id, *(face[c] for c in cols)),
        )
        crops.append((folder / f"{face['id']}.webp", folder / f"{cur.lastrowid}.webp"))
    return crops


async def with_versions(conn: aiosqlite.Connection, photo_ids: Sequence[int]) -> List[int]:
    """``photo_ids`` plus every other member of their groups (the original and its copies).

    Owner feedback 2026-11-18: one tile stands for the whole group, so deleting it deletes the
    group; otherwise the original behind an improved copy would come back on its own.
    ("What to keep" is how to drop just one version.)
    """
    ids = [int(i) for i in photo_ids]
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    async with conn.execute(
        f"""
        SELECT m.id FROM photos m
        WHERE m.id IN ({marks})
           OR COALESCE(m.derived_from_id, m.id) IN (
                SELECT COALESCE(p.derived_from_id, p.id) FROM photos p WHERE p.id IN ({marks}));
        """,
        (*ids, *ids),
    ) as cur:
        found = [r[0] for r in await cur.fetchall()]
    return sorted(set(found) | set(ids))


async def restore_with_versions(conn: aiosqlite.Connection, photo_ids: Sequence[int]) -> int:
    """Restores ``photo_ids`` from Trash with the group members deleted together with them.

    Members trashed at another time (e.g. an original replaced by its improved copy) stay in
    Trash. Returns how many photos came back.
    """
    ids = [int(i) for i in photo_ids]
    if not ids:
        return 0
    marks = ",".join("?" * len(ids))
    cur = await conn.execute(
        f"""
        UPDATE photos SET trashed_at = NULL, trash_expires_at = NULL
        WHERE trashed_at IS NOT NULL AND (
            id IN ({marks}) OR EXISTS (
                SELECT 1 FROM photos p WHERE p.id IN ({marks}) AND p.trashed_at = photos.trashed_at
                  AND COALESCE(p.derived_from_id, p.id) = COALESCE(photos.derived_from_id, photos.id)));
        """,
        (*ids, *ids),
    )
    return cur.rowcount


async def trash_photo(conn: aiosqlite.Connection, photo_id: int) -> None:
    """Moves a photo to Trash (restorable for 30 days), as the Trash button does."""
    await conn.execute("UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id = ? AND trashed_at IS NULL;", (photo_id,))
    await conn.execute("DELETE FROM video_processing_queue WHERE photo_id = ?;", (photo_id,))


async def versions_of(conn: aiosqlite.Connection, photo_id: int) -> Dict[str, Any]:
    """The original and every improved copy of ``photo_id``'s group, for the viewer's switch.

    Trashed members are listed with ``trashed: True`` so the viewer can offer "Restore original".
    """
    row = await _row(conn, photo_id)
    if row is None:
        raise VersionError("The photo no longer exists.")
    root_id = row["derived_from_id"] or row["id"]
    async with conn.execute(
        f"""
        SELECT id, ai_kind, derived_from_id, trashed_at, edited_at, choice_pending FROM photos
        WHERE id = ? OR derived_from_id = ? ORDER BY {pair_order()};
        """,
        (root_id, root_id),
    ) as cur:
        members = [
            {
                "id": r["id"],
                "is_original": r["derived_from_id"] is None,
                "ai_kind": r["ai_kind"],
                "trashed": r["trashed_at"] is not None,
                "edited_at": r["edited_at"],
                "choice_pending": bool(r["choice_pending"]),
            }
            for r in await cur.fetchall()
        ]
    return {"original_id": root_id, "members": members}


async def restore_original(conn: aiosqlite.Connection, photo_id: int) -> int:
    """Brings the original of an improved photo back from Trash (still linked). Returns its id.

    Raises:
        VersionError: ``photo_id`` isn't an improved photo, or its original was deleted for good.
    """
    row = await _row(conn, photo_id)
    if row is None or row["derived_from_id"] is None:
        raise VersionError("This photo has no original to restore.")
    original = await _row(conn, row["derived_from_id"])
    if original is None:
        raise VersionError("The original was deleted for good.")
    await conn.execute("UPDATE photos SET trashed_at = NULL, trash_expires_at = NULL WHERE id = ?;", (original["id"],))
    await conn.commit()
    return original["id"]
