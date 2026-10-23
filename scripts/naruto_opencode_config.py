"""Configuracao explicita sem segredos e caminho absoluto do MCP."""
import json
import os
import sys
from pathlib import Path

backend = "naruto_browser_mcp.py" if os.getenv("RPG_TRANSPORT") == "browser" else "naruto_guarded_mcp.py"

config = {"$schema": "https://opencode.ai/config.json", "permission": {"*": "deny", "naruto_*": "allow"},
          "mcp": {"naruto": {"type": "local", "command": [sys.executable, str(Path(__file__).with_name(backend).resolve())], "enabled": True, "timeout": 1800000}}}
Path(os.environ["OPENCODE_CONFIG"]).write_text(json.dumps(config, indent=2))
