import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path

sys.modules.setdefault("aiohttp", types.SimpleNamespace(ClientSession=object, ClientTimeout=object))
spec = importlib.util.spec_from_file_location("listener", Path(__file__).parent / "browser_actions/oidc_listener.py")
listener = importlib.util.module_from_spec(spec)
spec.loader.exec_module(listener)

class ListenerTests(unittest.IsolatedAsyncioTestCase):
    async def run_action(self, action):
        results, calls = [], []
        async def perform(a, command):
            calls.append(a)
            return {"online": True} if a == "status" else {"artifact_id": "123"}
        sys.modules["live_controller"] = types.SimpleNamespace(
            validate_command=lambda c, run: c["action"], perform=perform)
        async def call(method, path, **kwargs):
            if method == "GET":
                return {"command": {"id": "test", "session_id": "42", "action": action}}
            results.append(kwargs["payload"])
            raise asyncio.CancelledError()
        listener.call = call
        listener._state.update(run_id="42", runner_token="fake-test-only")
        with self.assertRaises(asyncio.CancelledError):
            await listener.listen_commands()
        return results[0], calls

    async def test_screenshot_reaches_existing_controller(self):
        result, calls = await self.run_action("screenshot")
        self.assertTrue(result["ok"])
        self.assertEqual(calls, ["screenshot"])
        self.assertEqual(result["data"]["artifact_id"], "123")

    async def test_status_reports_actual_listener_capabilities(self):
        result, _ = await self.run_action("status")
        self.assertIn("click", result["data"]["listener_capabilities"])
        self.assertIn("screenshot", result["data"]["listener_capabilities"])
        self.assertEqual(result["data"]["typing_scope"], "search_only")

    async def test_arbitrary_execution_still_denied(self):
        result, calls = await self.run_action("exec")
        self.assertFalse(result["ok"])
        self.assertEqual(calls, [])

if __name__ == "__main__":
    unittest.main()
