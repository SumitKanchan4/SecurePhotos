"""Tamper tests for the SPENC03 vault file format (backlog H2)."""

import secrets
import struct

import pytest

from engine.services.crypto_vault import (
    CHUNK_SIZE,
    HEADER_SIZE,
    decrypt_file_to_bytes,
    encrypt_file_chunked,
)

KEY = secrets.token_bytes(32)
DATA = secrets.token_bytes(CHUNK_SIZE * 3 + 1234)  # Four chunks, the last one partial.


def _encrypt(tmp_path, data=DATA, key=KEY, name="photo.enc"):
    path = tmp_path / name
    encrypt_file_chunked(data, path, key)
    return path


def _chunks(raw: bytes):
    """Splits an SPENC03 file into (header, [length-prefixed chunk records])."""
    header, pos, records = raw[:HEADER_SIZE], HEADER_SIZE, []
    while pos < len(raw):
        (length,) = struct.unpack(">I", raw[pos:pos + 4])
        records.append(raw[pos:pos + 4 + length])
        pos += 4 + length
    return header, records


def _rejected(path, key=KEY):
    with pytest.raises(ValueError):
        decrypt_file_to_bytes(path, key)


def test_round_trip_and_unique_per_file_salt(tmp_path):
    a, b = _encrypt(tmp_path, name="a.enc"), _encrypt(tmp_path, name="b.enc")
    assert decrypt_file_to_bytes(a, KEY) == DATA
    assert a.read_bytes()[:HEADER_SIZE] != b.read_bytes()[:HEADER_SIZE]  # Fresh salt (and key) per file.


def test_dropping_the_last_chunk_is_detected(tmp_path):
    path = _encrypt(tmp_path)
    header, records = _chunks(path.read_bytes())
    path.write_bytes(header + b"".join(records[:-1]))
    _rejected(path)


def test_cutting_to_header_only_is_detected(tmp_path):
    path = _encrypt(tmp_path)
    path.write_bytes(path.read_bytes()[:HEADER_SIZE])
    _rejected(path)


def test_empty_file_still_has_a_sealed_last_chunk(tmp_path):
    path = _encrypt(tmp_path, data=b"")
    assert decrypt_file_to_bytes(path, KEY) == b""
    path.write_bytes(path.read_bytes()[:HEADER_SIZE])
    _rejected(path)


def test_cutting_a_chunk_short_is_detected(tmp_path):
    path = _encrypt(tmp_path)
    path.write_bytes(path.read_bytes()[:-10])
    _rejected(path)


def test_appended_data_is_detected(tmp_path):
    path = _encrypt(tmp_path)
    header, records = _chunks(path.read_bytes())
    path.write_bytes(header + b"".join(records) + records[0])
    _rejected(path)


def test_dropped_or_reordered_middle_chunks_are_detected(tmp_path):
    path = _encrypt(tmp_path)
    header, records = _chunks(path.read_bytes())
    path.write_bytes(header + records[0] + b"".join(records[2:]))
    _rejected(path)
    path.write_bytes(header + records[1] + records[0] + b"".join(records[2:]))
    _rejected(path)


def test_chunks_from_another_file_are_rejected(tmp_path):
    a, b = _encrypt(tmp_path, name="a.enc"), _encrypt(tmp_path, name="b.enc")
    header_a, records_a = _chunks(a.read_bytes())
    _, records_b = _chunks(b.read_bytes())
    a.write_bytes(header_a + records_b[0] + b"".join(records_a[1:]))
    _rejected(a)


def test_header_tampering_is_detected(tmp_path):
    path = _encrypt(tmp_path)
    raw = bytearray(path.read_bytes())
    raw[HEADER_SIZE - 1] ^= 0x01  # Flip a bit of the file salt.
    path.write_bytes(bytes(raw))
    _rejected(path)


def test_old_format_files_are_refused(tmp_path):
    path = _encrypt(tmp_path)
    path.write_bytes(b"SPENC02\x00" + path.read_bytes()[8:])
    with pytest.raises(ValueError, match="current format"):
        decrypt_file_to_bytes(path, KEY)


def test_wrong_key_is_rejected(tmp_path):
    _rejected(_encrypt(tmp_path), key=secrets.token_bytes(32))
