"""Configuracao explicita sem segredos e caminho absoluto do MCP."""
import json
import os
import sys
from pathlib import Path

config = {"$schema": "https://opencode.ai/config.json", "permission": {"*": "deny", "naruto_*": "allow"},
          "mcp": {"naruto": {"type": "local", "command": [sys.executable, str(Path(__file__).with_name("naruto_guarded_mcp.py").resolve())], "enabled": True, "timeout": 90000}}}
Path(os.environ["OPENCODE_CONFIG"]).write_text(json.dumps(config, indent=2))
