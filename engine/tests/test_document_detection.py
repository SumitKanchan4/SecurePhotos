"""A8 (owner: "Find in photos brought all the images"): which photos count as documents.

The old rule matched letters inside words: "1040" (a US tax form) sat inside the phone's
timestamp file names of 20 ordinary photos, and OCR never ran (stored paths are relative).
"""

import secrets

import pytest

from engine.database import get_db_connection, run_migrations
from engine.services import document_service as docs
from engine.services.document_service import is_candidate_document as is_doc


@pytest.mark.parametrize(
    "name",
    [
        "1792341040811-1c9bc690-7433-41b8-b05b-6742f8547d2f.jpg",  # "1040" inside a timestamp.
        "IMG_20261104_104055.jpg",
        "PXL_20261115_181040123.jpg",
        "holiday_rx100.jpg",   # Camera model, not a prescription.
        "Taxi in Goa.jpg",     # "tax" inside "Taxi".
        "Billy's birthday.jpg",
        "scan.webp",               # A scan of an old photo is still a photo.
        "Grandpa scanned.jpg",
    ],
)
def test_ordinary_photo_names_are_not_documents(name):
    assert not is_doc(name, None, "image/jpeg")


@pytest.mark.parametrize("name", ["receipt croma.jpg", "Passport copy.jpg", "electricity_bill_march.png", "boarding-pass-goa.jpg", "x.pdf"])
def test_names_a_person_wrote_still_count(name):
    assert is_doc(name, None, "application/pdf" if name.endswith(".pdf") else "image/jpeg")


def test_ocr_noise_signs_and_t_shirts_are_not_documents():
    noise = "Iii llI mmm ooo Ww rn tab ;; 11 Xx ~~ ''' ---- iii nnn"  # What OCR reads in an old print.
    sign = "WELCOME TO SHIMLA Mall Road"
    tshirt = "TOTAL CHAOS crew"  # One document word, no real text.
    for text in (noise, sign, tshirt):
        assert not is_doc("1792341321410-1c9bc690-7433-41b8-b05b-6742f8547d2f.jpg", text, "image/jpeg")


def test_real_document_text_counts():
    receipt = "CROMA Retail Invoice No 4471 Qty 1 Rate 2499 Amount 2499 GST 18% Total 2949 Payment card Thank you"
    page = " ".join(["the quick brown fox jumps over lazy dogs"] * 8)  # A full page of text (a screenshot).
    assert is_doc("IMG_1234.jpg", receipt, "image/jpeg")
    assert is_doc("IMG_1235.jpg", page, "image/jpeg")
    assert docs.keyword_hits("subtotal: 10, total: 12") == 2  # Whole words only…
    assert docs.keyword_hits("totally portable table") == 0     # …not letters inside words.


async def test_onnxruntime_is_loaded_before_windows_ocr(tmp_path, monkeypatch):
    """Once Windows OCR has run, onnxruntime can't load in that process (measured): every AI
    feature would stop. The text reader always loads it first."""
    import sys
    import types

    from PIL import Image

    calls = []
    monkeypatch.setattr(docs, "load_onnxruntime_first", lambda: calls.append("onnxruntime"))

    async def recognize_pil(img, lang):
        calls.append("ocr")
        return types.SimpleNamespace(text="hello")

    monkeypatch.setitem(sys.modules, "winocr", types.SimpleNamespace(recognize_pil=recognize_pil))
    photo = tmp_path / "a.jpg"
    Image.new("RGB", (64, 48), "white").save(photo)
    assert await docs.extract_ocr_text_on_device(photo) == "hello"
    assert calls == ["onnxruntime", "ocr"]


async def test_wrong_scan_marks_go_back_to_photos_and_user_marks_stay():
    await run_migrations()
    tag = secrets.token_hex(3)
    conn = await get_db_connection()
    ids = []
    try:
        for name, source, text in (
            (f"1792341040811-{tag}-a.jpg", "scan", None),                       # Old rule's mistake.
            (f"receipt-{tag}.jpg", "scan", None),                                # Still a document.
            (f"1792341040899-{tag}-b.jpg", None, None),                          # Marked by the user: kept.
        ):
            cur = await conn.execute(
                "INSERT INTO photos (filename, filepath, file_size, mime_type, is_document, document_source, ocr_text) "
                "VALUES (?, ?, 1, 'image/jpeg', 1, ?, ?);",
                (name, f"originals/{name}", source, text),
            )
            ids.append(cur.lastrowid)
        assert await docs.recheck_scanned_documents(conn) >= 1
        async with conn.execute(f"SELECT id, is_document FROM photos WHERE id IN ({','.join('?' * 3)});", ids) as cur:
            flags = dict(await cur.fetchall())
        assert [flags[i] for i in ids] == [0, 1, 1]
    finally:
        await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(ids))});", ids)
        await conn.commit()
        await conn.close()
