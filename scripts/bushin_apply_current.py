#!/usr/bin/env python3
"""Run corrected readonly RPG code against this Linux's existing Chromium.

No desktop restart, browser restart, GitHub/Discord token, or profile copy.
This is a one-shot helper, not hot reload of the existing D1 listener.
"""
import asyncio
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path
from urllib.request import urlopen

REVISION = "4d9fbd97c8ace73db10bea7d9ff7cf8a20815a56"
EXPECTED_BLOB = "25b350ac9dd0c4b4599fd22941476167c16d4602"
SOURCE = ("https://raw.githubusercontent.com/hp0592553-cyber/naruto-rpg-ia/"
          + REVISION + "/browser_actions/live_controller.py")

def verified_source():
    with urlopen(SOURCE, timeout=25) as response:
        source = response.read(200000)
    blob = b"blob " + str(len(source)).encode() + b"\0" + source
    if hashlib.sha1(blob).hexdigest() != EXPECTED_BLOB:
        raise RuntimeError("Controller revision mismatch; nothing executed")
    return source

async def run():
    from playwright.async_api import async_playwright
    source = verified_source()
    with tempfile.TemporaryDirectory(prefix="bushin-current-") as temporary:
        path = Path(temporary) / "controller.py"
        path.write_bytes(source)
        spec = importlib.util.spec_from_file_location("bushin_current_controller", path)
        controller = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(controller)
        async with async_playwright() as pw:
            browser = await pw.chromium.connect_over_cdp(
                "http://127.0.0.1:9222", timeout=9000)
            page = await controller.get_page(browser)
            controller.assert_rp_channel(page.url)
            result = await controller.run_readonly_rpg_slash(page, "/perfil ver")
            print(json.dumps({"controller_revision": REVISION,
                              "browser_restarted": False, "result": result},
                             ensure_ascii=False))
            # Never browser.close(): the user owns this existing Chromium.

if __name__ == "__main__":
    try:
        asyncio.run(run())
    except Exception as exc:
        print(json.dumps({"executed": False, "error_type": type(exc).__name__,
                          "note": "No browser or desktop was restarted."}))
        raise SystemExit(1)
