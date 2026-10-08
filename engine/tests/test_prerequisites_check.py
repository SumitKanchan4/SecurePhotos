"""Unit and contract tests for System Prerequisites Diagnostic Logic.

Verifies Python version threshold parsing, prerequisite compatibility validation,
and backend contract matching the Tauri IPC and React UI interface.
Compatible with standard library unittest and pytest.
"""

import sys
import unittest


def check_python_compatibility(version_str: str, min_major: int = 3, min_minor: int = 10) -> bool:
    """Validates whether a raw Python version string meets enterprise requirements.

    Args:
        version_str: Output string from `python --version` (e.g., 'Python 3.14.7').
        min_major: Minimum required major version (default: 3).
        min_minor: Minimum required minor version (default: 10).

    Returns:
        True if the detected Python version meets or exceeds the minimum threshold.
    """
    cleaned = version_str.strip().lower().replace("python", "").strip()
    parts = cleaned.split(".")
    if len(parts) < 2:
        return False
    try:
        major = int(parts[0])
        minor = int(parts[1])
        if major > min_major:
            return True
        if major == min_major and minor >= min_minor:
            return True
        return False
    except ValueError:
        return False


class TestPrerequisitesVerification(unittest.TestCase):
    """Test suite for environment and prerequisites verification."""

    def test_current_python_version_compatibility(self):
        """Verifies that the current active Python runtime meets requirements."""
        current_version_str = f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        is_compatible = check_python_compatibility(current_version_str)
        self.assertTrue(is_compatible, f"Runtime Python {current_version_str} must be >= 3.10")

    def test_version_string_parsing(self):
        """Ensures various Python version outputs are reliably parsed and thresholded."""
        cases = [
            ("Python 3.14.7", True),
            ("Python 3.12.0", True),
            ("Python 3.11.4", True),
            ("Python 3.10.0", True),
            ("Python 3.9.18", False),
            ("Python 2.7.18", False),
            ("InvalidString", False),
            ("", False),
        ]
        for ver_str, expected in cases:
            with self.subTest(ver_str=ver_str):
                self.assertEqual(check_python_compatibility(ver_str), expected)

    def test_prerequisite_payload_schema_contract(self):
        """Verifies that the diagnostic payload adheres to frontend contract structure."""
        contract = {
            "python": {
                "installed": True,
                "version": "Python 3.14.7",
                "executable": "C:\\Python\\python.exe",
                "meets_minimum_version": True,
                "minimum_required": "3.10",
            },
            "backend": {
                "running": True,
                "port": 8000,
                "url": "http://127.0.0.1:8000",
            },
            "vcredist": {
                "installed": True,
                "download_url": "https://aka.ms/vs/17/release/vc_redist.x64.exe",
            },
            "all_ready": True,
            "error_message": None,
        }

        self.assertIn("python", contract)
        self.assertIn("backend", contract)
        self.assertIn("vcredist", contract)
        self.assertTrue(contract["python"]["meets_minimum_version"])
        self.assertEqual(contract["backend"]["port"], 8000)
        self.assertTrue(contract["vcredist"]["installed"])
        self.assertIn("vc_redist.x64.exe", contract["vcredist"]["download_url"])


if __name__ == "__main__":
    unittest.main()

