import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

spec = importlib.util.spec_from_file_location("controls_real", Path(__file__).parent / "browser_actions/live_controller.py")
controls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controls)
URL = "https://discord.com/channels/1515877468299595919/1520114348079583263"

class ValidationTests(TestCase):
    def test_newlines_rejected(self):
        for text in ("hello\nworld", "hello\rworld"):
            with self.assertRaises(ValueError):
                controls.validate_command({"id":"test","session_id":"42","action":"type_search","text":text},"42")

    def test_wrong_session_rejected(self):
        with self.assertRaises(ValueError):
            controls.validate_command({"id":"test","session_id":"other","action":"click","x":4,"y":4},"42")

    def test_click_coordinates_bounded(self):
        for x in (-1, 1365, True):
            with self.assertRaises(ValueError):
                controls.validate_command({"id":"test","session_id":"42","action":"click","x":x,"y":4},"42")

class ControlTests(IsolatedAsyncioTestCase):
    async def test_navigation_click_executes(self):
        page = SimpleNamespace(url=URL, evaluate=AsyncMock(return_value={"allowed":True}),
            mouse=SimpleNamespace(click=AsyncMock()), wait_for_timeout=AsyncMock())
        result = await controls.safe_point_click(page, 50, 70)
        self.assertEqual(result["clicked"], [50,70])
        page.mouse.click.assert_awaited_once()

    async def test_sensitive_click_never_executes(self):
        page = SimpleNamespace(url=URL, evaluate=AsyncMock(return_value={"allowed":False}),
            mouse=SimpleNamespace(click=AsyncMock()))
        with self.assertRaises(ValueError):
            await controls.safe_point_click(page, 50, 70)
        page.mouse.click.assert_not_awaited()

    async def test_search_fill_does_not_submit(self):
        box=SimpleNamespace(is_visible=AsyncMock(return_value=True), fill=AsyncMock())
        locator=SimpleNamespace(count=AsyncMock(return_value=1),first=box)
        selectors=[]
        def locate(selector):
            selectors.append(selector)
            return locator
        page=SimpleNamespace(url=URL,locator=locate)
        result=await controls.safe_type_search(page,"Henrique")
        self.assertTrue(result["search_filled"])
        box.fill.assert_awaited_once_with("Henrique",timeout=6500)
        self.assertIn('[role="searchbox"]', selectors[0])

    async def test_capture_denied_outside_guild(self):
        page=SimpleNamespace(url="https://discord.com/channels/@me")
        with self.assertRaises(ValueError):
            await controls.publish_private_screenshot(page,"42")

    async def test_capture_upload_and_cleanup(self):
        async def screenshot(**kwargs):
            Path(kwargs["path"]).write_bytes(bytes([255,216,255,0]))
        page=SimpleNamespace(url=URL,
            locator=lambda _:SimpleNamespace(count=AsyncMock(return_value=0)),
            screenshot=AsyncMock(side_effect=screenshot))
        result=SimpleNamespace(returncode=0,stdout='{"artifact_id":123}\n')
        with patch.object(controls.subprocess,"run",return_value=result) as run:
            value=await controls.publish_private_screenshot(page,"42")
        self.assertEqual(value["artifact_id"],123)
        uploaded=run.call_args.args[0][2]
        self.assertFalse(Path(uploaded).exists())
