"""Real Chromium smoke test. No Discord network, account, token, or login."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from playwright.async_api import async_playwright
from browser_actions import live_controller as controls

FIXTURE_URL = "https://www.google.com/search?q=Bushin-test"
HTML = """<!doctype html><html><body style="margin:30px">
<h1>Bushin: isolated test page</h1>
<button id="test" style="width:180px;height:60px" onclick="this.textContent='CLICK OK'">Test click</button>
<input type="search" aria-label="Buscar" placeholder="Buscar">
<div style="height:1800px">Synthetic test data. No Discord connection.</div></body></html>"""

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            context = await browser.new_context(viewport={"width":1365,"height":768},service_workers="block")
            # Fully isolated fixture: requests to all other origins are aborted.
            async def intercept(route):
                if route.request.url == FIXTURE_URL and route.request.is_navigation_request():
                    await route.fulfill(status=200,content_type="text/html",body=HTML)
                else:
                    await route.abort()
            await context.route("**/*", intercept)
            page = await context.new_page()
            await page.goto(FIXTURE_URL)
            box=await page.locator("#test").bounding_box()
            await controls.safe_point_click(page,int(box["x"]+box["width"]/2),int(box["y"]+box["height"]/2))
            assert await page.locator("#test").inner_text() == "CLICK OK"
            await controls.safe_type_search(page,"Bushin test 123")
            assert await page.locator('input[type="search"]').input_value() == "Bushin test 123"
            await page.mouse.wheel(0,170)
            await page.wait_for_function("window.scrollY > 0")
            uploaded=[]
            def fake_upload(args, **kwargs):
                # Only upload is mocked. Chromium must create a real JPEG first.
                file=Path(args[2])
                data=file.read_bytes()
                assert data.startswith(bytes([255,216,255])) and len(data)>1000
                uploaded.append(file)
                return SimpleNamespace(returncode=0,stdout='{"artifact_id":123}')
            with patch.object(controls.subprocess,"run",side_effect=fake_upload):
                result=await controls.publish_private_screenshot(page,"42")
            assert result["artifact_id"] == 123 and not uploaded[0].exists()
            print(json.dumps({"click":"passed","typing":"passed","scroll":"passed",
                "real_jpeg":"passed","cleanup":"passed","network":"isolated",
                "artifact_upload":"mocked","discord_login_used":False}))
        finally:
            await browser.close()
if __name__ == "__main__":
    asyncio.run(main())

