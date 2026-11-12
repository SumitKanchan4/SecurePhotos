"""Root entrypoint launcher for SecurePhotos Engine sidecar."""

import sys
from pathlib import Path

# Ensure project root is in sys.path
root = Path(__file__).resolve().parent
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from engine.main import app, parse_args
from engine.config import settings
import uvicorn
import logging

logger = logging.getLogger("securephotos.main")

if __name__ == "__main__":
    args = parse_args()
    settings.port = args.port
    settings.host = args.host
    settings.data_dir = Path(args.data_dir)

    logger.info(f"Starting {settings.app_name} on http://{settings.host}:{settings.port}")
    logger.info(f"Data Directory: {settings.data_dir}")

    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        reload=False,
    )

