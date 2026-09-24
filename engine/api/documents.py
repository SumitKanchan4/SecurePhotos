"""API Endpoints for Document Intelligence, OCR, and Categorization.

Provides listing, filtering, on-demand scanning, and metadata curation for
receipts, invoices, tax forms, IDs, and scanned records.
"""

import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from engine.services.document_service import (
    classify_document,
    import_documents_direct,
    list_documents,
    scan_library_for_documents,
    toggle_document_pin,
    toggle_document_status,
    update_document_metadata,
)

logger = logging.getLogger("securephotos.api.documents")

router = APIRouter(prefix="/api/documents", tags=["Documents"])


class DocumentResponse(BaseModel):
    """Payload representing a single document item."""
    id: int
    title: str
    filename: str
    filepath: str
    category: str
    date: str
    file_size: str
    file_size_bytes: int
    mime_type: str
    extracted_text: str
    is_encrypted: bool
    is_pinned: bool = False
    vault_type: Optional[str] = None
    thumbnail_path: Optional[str] = None
    preview_path: Optional[str] = None


class DocumentScanResponse(BaseModel):
    """Result summary of a library document scan."""
    total_scanned: int
    newly_detected: int
    categories: Dict[str, int]


class DocumentUpdateRequest(BaseModel):
    """Payload for updating document metadata."""
    category: Optional[str] = None
    title: Optional[str] = None
    ocr_text: Optional[str] = None


class DocumentToggleRequest(BaseModel):
    """Payload for setting or clearing document classification."""
    is_document: bool


class DocumentImportRequest(BaseModel):
    """Payload for importing document files directly."""
    file_paths: List[str]


@router.get("", response_model=List[DocumentResponse], status_code=status.HTTP_200_OK)
async def get_documents(
    category: Optional[str] = Query(default=None, description="Optional category filter (receipt, identity, tax, medical, etc.)"),
    q: Optional[str] = Query(default=None, description="Optional search term matching title, filename, or OCR text"),
) -> List[DocumentResponse]:
    """Retrieves all active scanned documents and receipts.

    Args:
        category: Optional category filter.
        q: Optional search query.

    Returns:
        List of DocumentResponse items matching criteria.
    """
    docs = await list_documents(category=category, search_query=q)
    return [DocumentResponse(**d) for d in docs]


@router.post("/scan", response_model=DocumentScanResponse, status_code=status.HTTP_200_OK)
async def scan_documents() -> DocumentScanResponse:
    """Scans all active media items in the library to detect receipts and documents.

    Automatically analyzes filenames, OCR tokens, and patterns to flag documents
    and categorize them into Receipts, IDs, Tax, Medical, and Legal categories.

    Returns:
        DocumentScanResponse containing scan statistics and category breakdowns.
    """
    res = await scan_library_for_documents()
    return DocumentScanResponse(**res)


@router.patch("/{photo_id}", status_code=status.HTTP_200_OK)
async def update_document(
    photo_id: int,
    payload: DocumentUpdateRequest,
) -> Dict[str, Any]:
    """Updates the category, custom title, or OCR text of a document.

    Args:
        photo_id: ID of the photo item.
        payload: Fields to update.

    Returns:
        Success confirmation dictionary.
    """
    success = await update_document_metadata(
        photo_id=photo_id,
        category=payload.category,
        title=payload.title,
        ocr_text=payload.ocr_text,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document with ID {photo_id} was not found or is in trash.",
        )
    return {"status": "success", "photo_id": photo_id, "updated": True}


@router.post("/{photo_id}/toggle", status_code=status.HTTP_200_OK)
async def toggle_document(
    photo_id: int,
    payload: DocumentToggleRequest,
) -> Dict[str, Any]:
    """Marks or unmarks a photo as a document.

    Args:
        photo_id: Target photo ID.
        payload: Object containing is_document boolean.

    Returns:
        Success confirmation dictionary.
    """
    success = await toggle_document_status(photo_id=photo_id, is_doc=payload.is_document)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Photo with ID {photo_id} was not found or is in trash.",
        )
    return {"status": "success", "photo_id": photo_id, "is_document": payload.is_document}


@router.post("/{photo_id}/pin", status_code=status.HTTP_200_OK)
async def toggle_pin(photo_id: int) -> Dict[str, Any]:
    """Toggles pinned status of a document item.

    Pinned documents remain permanently anchored at the top of the collection.

    Args:
        photo_id: Target document ID.

    Returns:
        Confirmation dictionary with updated is_pinned boolean.
    """
    new_pinned = await toggle_document_pin(photo_id)
    return {"status": "success", "photo_id": photo_id, "is_pinned": new_pinned}


@router.post("/import", response_model=List[DocumentResponse], status_code=status.HTTP_201_CREATED)
async def import_documents(payload: DocumentImportRequest) -> List[DocumentResponse]:
    """Directly ingests files as documents into the library.

    Args:
        payload: DocumentImportRequest containing file_paths.

    Returns:
        List of newly created DocumentResponse objects.
    """
    if not payload.file_paths:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file paths provided for direct document import.",
        )
    docs = await import_documents_direct(payload.file_paths)
    return [DocumentResponse(**d) for d in docs]

