"""External Volume Tracker and Drive Letter Portability Engine for SecurePhotos.

This module provides hardware volume UUID resolution and dynamic drive letter mapping
on Windows to ensure the photo library functions reliably even when external USB drives
are assigned different drive letters (e.g., E:\\ to F:\\).
"""

import ctypes
import logging
import os
import platform
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel

logger = logging.getLogger("securephotos.volume_tracker")


class VolumeInfo(BaseModel):
    """Metadata describing a physical storage volume.

    Attributes:
        drive_letter: Windows mount point (e.g. 'E:\\').
        volume_name: Label of the drive (e.g. 'Samsung_T7').
        volume_serial: Physical hardware serial number / UUID string.
        file_system: Filesystem format (NTFS, exFAT, FAT32).
        is_ready: Whether the drive is currently mounted and accessible.
        free_bytes: Available disk space in bytes.
        total_bytes: Total storage capacity in bytes.
    """

    drive_letter: str
    volume_name: str
    volume_serial: str
    file_system: str
    is_ready: bool = True
    free_bytes: int = 0
    total_bytes: int = 0


def get_volume_serial(path: str | Path) -> Optional[str]:
    """Retrieves the physical volume serial number for a given path on Windows.

    Args:
        path: File or folder path on the target volume.

    Returns:
        Hexadecimal string of volume serial (e.g. '3A4B-5C6D'), or None if unavailable.
    """
    if platform.system() != "Windows":
        # POSIX fallback using stat.st_dev
        try:
            stat = os.stat(path)
            return str(stat.st_dev)
        except Exception:
            return None

    try:
        drive_root = os.path.splitdrive(os.path.abspath(path))[0]
        if not drive_root.endswith("\\"):
            drive_root += "\\"

        volume_name_buffer = ctypes.create_unicode_buffer(1024)
        file_system_buffer = ctypes.create_unicode_buffer(1024)
        serial_number = ctypes.c_ulong()
        max_component_length = ctypes.c_ulong()
        file_system_flags = ctypes.c_ulong()

        kernel32 = ctypes.windll.kernel32
        success = kernel32.GetVolumeInformationW(
            ctypes.c_wchar_p(drive_root),
            volume_name_buffer,
            ctypes.sizeof(volume_name_buffer),
            ctypes.byref(serial_number),
            ctypes.byref(max_component_length),
            ctypes.byref(file_system_flags),
            file_system_buffer,
            ctypes.sizeof(file_system_buffer),
        )

        if success:
            raw_serial = serial_number.value
            return f"{(raw_serial >> 16) & 0xFFFF:04X}-{raw_serial & 0xFFFF:04X}"
    except Exception as e:
        logger.warning(f"Failed to query volume serial for {path}: {e}")

    return None


def list_connected_volumes() -> List[VolumeInfo]:
    """Enumerates all active logical drives and their volume serials on Windows.

    Returns:
        List of VolumeInfo objects for all connected drives.
    """
    volumes: List[VolumeInfo] = []

    if platform.system() != "Windows":
        return volumes

    try:
        kernel32 = ctypes.windll.kernel32
        bitmask = kernel32.GetLogicalDrives()

        for letter_code in range(26):
            if bitmask & (1 << letter_code):
                drive_letter = f"{chr(65 + letter_code)}:\\"
                drive_type = kernel32.GetDriveTypeW(ctypes.c_wchar_p(drive_letter))
                
                # Filter for fixed drives (3) and removable USB drives (2)
                if drive_type in (2, 3):
                    volume_name_buf = ctypes.create_unicode_buffer(1024)
                    file_sys_buf = ctypes.create_unicode_buffer(1024)
                    serial = ctypes.c_ulong()

                    success = kernel32.GetVolumeInformationW(
                        ctypes.c_wchar_p(drive_letter),
                        volume_name_buf,
                        ctypes.sizeof(volume_name_buf),
                        ctypes.byref(serial),
                        None,
                        None,
                        file_sys_buf,
                        ctypes.sizeof(file_sys_buf),
                    )

                    if success:
                        free_bytes = ctypes.c_ulonglong()
                        total_bytes = ctypes.c_ulonglong()
                        kernel32.GetDiskFreeSpaceExW(
                            ctypes.c_wchar_p(drive_letter),
                            None,
                            ctypes.byref(total_bytes),
                            ctypes.byref(free_bytes),
                        )
                        raw_serial = serial.value
                        serial_str = f"{(raw_serial >> 16) & 0xFFFF:04X}-{raw_serial & 0xFFFF:04X}"

                        volumes.append(
                            VolumeInfo(
                                drive_letter=drive_letter,
                                volume_name=volume_name_buf.value or "Local Disk",
                                volume_serial=serial_str,
                                file_system=file_sys_buf.value,
                                is_ready=True,
                                free_bytes=free_bytes.value,
                                total_bytes=total_bytes.value,
                            )
                        )
    except Exception as e:
        logger.error(f"Error enumerating connected volumes: {e}", exc_info=True)

    return volumes


def resolve_drive_by_serial(target_serial: str) -> Optional[str]:
    """Finds the current active Windows drive letter matching a given volume serial.

    Args:
        target_serial: The serial number stored in database records (e.g. '3A4B-5C6D').

    Returns:
        The current drive root (e.g. 'F:\\') or None if the drive is disconnected.
    """
    for vol in list_connected_volumes():
        if vol.volume_serial.upper() == target_serial.upper():
            return vol.drive_letter
    return None
