"""Document Intelligence and On-Device Classification Service.

Delivers local categorization, heuristic detection, and metadata management
for receipts, invoices, passports, tax filings, medical records, and legal forms.
"""

import datetime
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import aiosqlite

from engine.config import settings
from engine.database import get_db_connection

logger = logging.getLogger("securephotos.document_service")

# Keyword lexicons for deterministic local categorization
CATEGORY_KEYWORDS = {
    "receipt": [
        "receipt", "invoice", "bill", "payment", "subtotal", "total", "cashier",
        "merchant", "pos", "order", "checkout", "transaction", "purchase",
        "supermarket", "walmart", "target", "costco", "amazon", "uber", "lyft",
    ],
    "identity": [
        "passport", "license", "driver", "identification", "national_id", "aadhaar",
        "citizenship", "visa", "voter", "birth_certificate", "ssn", "identity",
    ],
    "tax": [
        "tax", "1040", "w2", "w-2", "1099", "irs", "revenue", "deduction",
        "withholding", "income_tax", "fiscal", "tax_return", "audit",
    ],
    "medical": [
        "medical", "prescription", "rx", "patient", "doctor", "clinic", "hospital",
        "diagnosis", "health", "pharmacy", "vaccine", "lab_report", "blood_test",
    ],
    "legal": [
        "contract", "agreement", "lease", "nda", "terms", "deed", "certificate",
        "notary", "affidavit", "compliance", "settlement", "court",
    ],
    "warranty": [
        "warranty", "guarantee", "manual", "user_guide", "serial_number",
        "model_no", "instructions", "coverage", "appliance",
    ],
}


def format_file_size(size_bytes: int) -> str:
    """Formats raw byte counts into clean human-readable strings."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


def classify_document(
    filename: str,
    ocr_text: Optional[str] = None,
    mime_type: Optional[str] = None,
) -> str:
    """Classifies a media item into a document category based on text and name cues.

    Args:
        filename: Original file name.
        ocr_text: Optional extracted text tokens from OCR.
        mime_type: Optional MIME content type.

    Returns:
        One of 'receipt', 'identity', 'tax', 'medical', 'legal', 'warranty', or 'other'.
    """
    corpus = f"{filename} {ocr_text or ''}".lower()

    # Score each category based on keyword occurrence
    best_category = "other"
    max_matches = 0

    for cat, keywords in CATEGORY_KEYWORDS.items():
        matches = sum(1 for kw in keywords if kw in corpus)
        if matches > max_matches:
            max_matches = matches
            best_category = cat

    # Default PDF files without specific matches to 'other'
    if max_matches == 0 and (mime_type == "application/pdf" or filename.lower().endswith(".pdf")):
        return "other"

    return best_category


def is_candidate_document(
    filename: str,
    ocr_text: Optional[str] = None,
    mime_type: Optional[str] = None,
) -> bool:
    """Determines whether a media item is likely a document or scanned paper.

    Args:
        filename: Name of the file.
        ocr_text: Extracted OCR text if already scanned.
        mime_type: Media MIME type.

    Returns:
        True if the file matches document characteristics.
    """
    fn_lower = filename.lower()
    if mime_type == "application/pdf" or fn_lower.endswith(".pdf"):
        return True

    doc_indicators = [
        "doc", "scan", "receipt", "invoice", "bill", "passport", "license",
        "tax", "1040", "w2", "medical", "rx", "contract", "statement", "form",
        "ticket", "boarding_pass", "paper", "memo", "letter",
    ]
    for ind in doc_indicators:
        if ind in fn_lower:
            return True

    if ocr_text and len(ocr_text.strip()) > 20:
        return True

    return False


async def scan_library_for_documents() -> Dict[str, Any]:
    """Scans all active library photos and classifies newly identified documents.

    Returns:
        Dictionary containing total_scanned, newly_detected, and category breakdown.
    """
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT id, filename, filepath, file_size, mime_type, is_document, ocr_text, content_tags
            FROM photos
            WHERE trashed_at IS NULL
            ORDER BY id ASC;
            """
        ) as cursor:
            rows = await cursor.fetchall()

        total_scanned = len(rows)
        newly_detected = 0
        categories_count: Dict[str, int] = {}

        for r in rows:
            photo_id = r["id"]
            filename = r["filename"] or ""
            ocr_text = r["ocr_text"] or ""
            mime_type = r["mime_type"] or ""
            current_is_doc = bool(r["is_document"])

            # Check if this item qualifies as a document
            if not current_is_doc and is_candidate_document(filename, ocr_text, mime_type):
                category = classify_document(filename, ocr_text, mime_type)
                await conn.execute(
                    """
                    UPDATE photos
                    SET is_document = 1,
                        content_tags = ?
                    WHERE id = ?;
                    """,
                    (category, photo_id),
                )
                newly_detected += 1
                categories_count[category] = categories_count.get(category, 0) + 1
            elif current_is_doc:
                # Ensure existing documents have a valid category tag
                category = r["content_tags"] or classify_document(filename, ocr_text, mime_type)
                if r["content_tags"] != category:
                    await conn.execute(
                        "UPDATE photos SET content_tags = ? WHERE id = ?;",
                        (category, photo_id),
                    )
                categories_count[category] = categories_count.get(category, 0) + 1

        await conn.commit()
        return {
            "total_scanned": total_scanned,
            "newly_detected": newly_detected,
            "categories": categories_count,
        }
    finally:
        await conn.close()


async def list_documents(
    category: Optional[str] = None,
    search_query: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Retrieves all active documents matching optional category and text filters.

    Args:
        category: Optional category filter ('receipt', 'identity', 'tax', etc.).
        search_query: Optional search keyword to filter title, filename, or OCR text.

    Returns:
        List of formatted document dictionaries.
    """
    conn = await get_db_connection()
    try:
        query = """
            SELECT p.id, p.filename, p.filepath, p.file_size, p.mime_type,
                   p.taken_at, p.created_at, p.is_favorite, p.is_encrypted,
                   p.vault_type, p.thumbnail_path, p.preview_path,
                   p.ocr_text, p.caption, p.content_tags
            FROM photos p
            WHERE (p.is_document = 1 OR p.mime_type = 'application/pdf' OR p.filename LIKE '%.pdf')
              AND p.trashed_at IS NULL
        """
        params: List[Any] = []

        if category and category != "all":
            query += " AND p.content_tags = ?"
            params.append(category)

        if search_query and search_query.strip():
            sq = f"%{search_query.strip()}%"
            query += " AND (p.filename LIKE ? OR p.ocr_text LIKE ? OR p.caption LIKE ?)"
            params.extend([sq, sq, sq])

        query += " ORDER BY COALESCE(p.taken_at, p.created_at) DESC, p.id DESC;"

        async with conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()

        documents: List[Dict[str, Any]] = []
        for r in rows:
            cat = r["content_tags"] or classify_document(r["filename"], r["ocr_text"], r["mime_type"])
            date_str = r["taken_at"] or r["created_at"] or ""
            if date_str and " " in str(date_str):
                date_str = str(date_str).split(" ")[0]

            documents.append({
                "id": r["id"],
                "title": Path(r["filename"]).stem.replace("_", " ").title() if r["filename"] else "Untitled Document",
                "filename": r["filename"] or "",
                "filepath": r["filepath"] or "",
                "category": cat,
                "date": str(date_str),
                "file_size": format_file_size(r["file_size"] or 0),
                "file_size_bytes": r["file_size"] or 0,
                "mime_type": r["mime_type"] or "image/jpeg",
                "extracted_text": r["ocr_text"] or "",
                "is_encrypted": bool(r["is_encrypted"]),
                "vault_type": r["vault_type"],
                "thumbnail_path": r["thumbnail_path"],
                "preview_path": r["preview_path"],
            })

        return documents
    finally:
        await conn.close()


async def update_document_metadata(
    photo_id: int,
    category: Optional[str] = None,
    title: Optional[str] = None,
    ocr_text: Optional[str] = None,
) -> bool:
    """Updates category, custom title, or OCR text for a document.

    Args:
        photo_id: ID of the photo item.
        category: New category string.
        title: Optional custom display title.
        ocr_text: Optional manual or corrected OCR text.

    Returns:
        True if updated successfully.
    """
    conn = await get_db_connection()
    try:
        updates = ["is_document = 1"]
        params: List[Any] = []

        if category is not None:
            updates.append("content_tags = ?")
            params.append(category)

        if ocr_text is not None:
            updates.append("ocr_text = ?")
            params.append(ocr_text)

        if title is not None:
            updates.append("caption = ?")
            params.append(title)

        params.append(photo_id)
        query = f"UPDATE photos SET {', '.join(updates)} WHERE id = ? AND trashed_at IS NULL;"
        cursor = await conn.execute(query, params)
        await conn.commit()
        return cursor.rowcount > 0
    finally:
        await conn.close()


async def toggle_document_status(photo_id: int, is_doc: bool) -> bool:
    """Sets or clears the document flag for a photo.

    Args:
        photo_id: ID of the photo.
        is_doc: True to mark as document, False to mark as normal photo.

    Returns:
        True if modified.
    """
    conn = await get_db_connection()
    try:
        cursor = await conn.execute(
            "UPDATE photos SET is_document = ? WHERE id = ? AND trashed_at IS NULL;",
            (1 if is_doc else 0, photo_id),
        )
        await conn.commit()
        return cursor.rowcount > 0
    finally:
        await conn.close()
