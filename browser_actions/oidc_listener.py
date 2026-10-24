#!/usr/bin/env python3
"""GitHub Actions OIDC -> Cloudflare D1 command listener (no Discord token)."""
import asyncio
import json
import os
from urllib.parse import urlencode

from aiohttp import ClientSession, ClientTimeout

WORKER = "https://bushin-discord-direct.henrique-silva081106.workers.dev"
AUDIENCE = "bushin-cloudflare-visual-v1"
READ_ACTIONS = frozenset({"status", "read_page_text", "rpg_view", "rpg_scout",
                         "inspect_ui", "open_url", "scroll", "press", "type_search",
                         "rpg_slash"})
_state = {}


async def call(method, path, *, bearer, payload=None, url=None):
    async with ClientSession(timeout=ClientTimeout(total=25)) as session:
        async with session.request(method, url or WORKER + path,
                                   headers={"Authorization": "Bearer " + bearer,
                                            "Cache-Control": "no-store"},
                                   json=payload) as response:
            try:
                data = await response.json(content_type=None)
            except Exception:
                raise RuntimeError(f"Bridge returned invalid JSON (HTTP {response.status})")
            if response.status >= 400:
                raise RuntimeError(f"Bridge HTTP {response.status}: {str(data.get('error', 'rejected'))[:100]}")
            return data


async def register_runner():
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    bearer = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    if not run_id.isdigit() or not url or not bearer:
        raise RuntimeError("GitHub Actions OIDC environment is unavailable")
    sep = "&" if "?" in url else "?"
    oidc = await call("GET", "", bearer=bearer,
                      url=url + sep + urlencode({"audience": AUDIENCE}))
    token = oidc.get("value")
    if not isinstance(token, str) or not token:
        raise RuntimeError("GitHub did not issue an OIDC assertion")
    registered = await call("POST", "/bridge/runner/register", bearer=token)
    if not registered.get("registered") or str(registered.get("run_id")) != run_id:
        raise RuntimeError("Cloudflare did not authorize the current Actions run")
    _state["run_id"], _state["runner_token"] = run_id, registered["runner_token"]
    print("🍥 OIDC verified; Cloudflare visual listener registered.", flush=True)


async def publish_takeover(url):
    if not _state:
        raise RuntimeError("Runner must register before publishing desktop link")
    result = await call("POST", "/bridge/runner/takeover?run_id=" + _state["run_id"],
                        bearer=_state["runner_token"], payload={"url": url})
    if not result.get("secured"):
        raise RuntimeError("Cloudflare did not store secure takeover link")
    print("🍥 Private browser link secured in Cloudflare. Open /mobile/visual.", flush=True)


async def listen_commands():
    from live_controller import validate_command, perform

    if not _state:
        raise RuntimeError("Runner is not registered")
    run_id, token = _state["run_id"], _state["runner_token"]
    errors = 0
    while True:
        try:
            poll = await call("GET", "/bridge/runner/poll?run_id=" + run_id,
                              bearer=token)
            command = poll.get("command")
            if not command:
                errors = 0
                await asyncio.sleep(4)
                continue
            ident = command.get("id", "")
            try:
                action = validate_command(command, run_id)
                if action not in READ_ACTIONS:
                    raise ValueError("Action disabled in OIDC listener; use secure viewer")
                data = await perform(action, command)
                if len(json.dumps(data, ensure_ascii=False)) > 11000:
                    data = {"truncated": True,
                            "preview": json.dumps(data, ensure_ascii=False)[:9500]}
                result = {"id": ident, "ok": True, "data": data}
            except Exception as exc:
                result = {"id": ident, "ok": False,
                          "error": str(exc)[:260]}
            ack = await call("POST", "/bridge/runner/result?run_id=" + run_id,
                              bearer=token, payload=result)
            if not ack.get("stored"):
                raise RuntimeError("Cloudflare refused to store command result")
            print("🍥 Visual command completed:", str(ident)[:45],
                  "ok:", result["ok"], flush=True)
            errors = 0
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            errors += 1
            print("🍥 Bridge connection retry:", type(exc).__name__, flush=True)
            if errors >= 24:
                raise RuntimeError("Cloudflare bridge not responding; ending runner")
            await asyncio.sleep(min(5 + errors, 20))
