#!/usr/bin/env python3
"""MCP stdio restrito: apenas API oficial de bot, nunca token de usuario."""
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

GUILD_ID = "1515877468299595919"
CHANNEL_ID = "1520114348079583263"
NARUTO_BOT_ID = "1515908078913192026"
app = Server("naruto-rpg-guardado")


def audit(tool, outcome, **details):
    path = os.getenv("RPG_AUDIT_PATH")
    if path:
        with Path(path).open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"time": datetime.now(timezone.utc).isoformat(),
                                     "phase": os.getenv("RPG_PHASE", "unknown"),
                                     "tool": tool, "outcome": outcome, **details}) + "\n")


def reply(data):
    return [TextContent(type="text", text=json.dumps(data, ensure_ascii=False))]


@app.list_tools()
async def list_tools():
    audit("list_tools", "ok")
    return [Tool(name="status_rpg", description="Diagnostica autenticacao oficial de bot e acesso ao canal; nao joga como Henrique.",
                 inputSchema={"type": "object", "properties": {}, "additionalProperties": False})]


async def status():
    result = {"character_connected": False, "command_sent": False,
              "command_completed": False, "rpg_state_verified": False,
              "guild_id": GUILD_ID, "channel_id": CHANNEL_ID,
              "integration": "official_bot_read_only", "slash_execution": "blocked_no_authorized_naruto_api"}
    token = os.getenv("DISCORD_BOT_TOKEN", "")
    if not token:
        return {**result, "status": "blocked_missing_bot_token",
                "reason": "DISCORD_USER_TOKEN nao e utilizado. Necessario bot oficial e integracao autorizada pelo Naruto Bot para agir como Henrique."}
    # Somente autenticacao Bot. Nunca fazer fallback para token de usuario.
    async with httpx.AsyncClient(base_url="https://discord.com/api/v10", timeout=20,
                                 headers={"Authorization": "Bot " + token}) as client:
        for stage, path in [("identity", "/users/@me"), ("guild", f"/guilds/{GUILD_ID}"),
                            ("channel", f"/channels/{CHANNEL_ID}"),
                            ("history", f"/channels/{CHANNEL_ID}/messages?limit=12")]:
            try:
                response = await client.get(path)
            except httpx.HTTPError as exc:
                return {**result, "status": "network_error", "stage": stage, "error_type": type(exc).__name__}
            if response.status_code != 200:
                return {**result, "status": "discord_http_error", "stage": stage, "http_status": response.status_code}
            data = response.json()
            if stage == "identity":
                if data.get("bot") is not True:
                    return {**result, "status": "blocked_non_bot_identity"}
                result["bot_authenticated"] = True
                result["bot_id"] = data["id"]
            elif stage == "guild":
                if str(data.get("id")) != GUILD_ID:
                    return {**result, "status": "wrong_guild"}
                result["guild_accessed"] = True
            elif stage == "channel":
                if str(data.get("guild_id")) != GUILD_ID or str(data.get("id")) != CHANNEL_ID:
                    return {**result, "status": "wrong_channel"}
                result["channel_accessed"] = True
            else:
                result["history_read"] = True
                # IDs sao evidencia de leitura; mensagens antigas nao comprovam uma nova jogada.
                result["observed_naruto_message_ids"] = [m["id"] for m in data if str(m.get("author", {}).get("id")) == NARUTO_BOT_ID]
    return {**result, "status": "blocked_no_authorized_naruto_api"}


@app.call_tool()
async def call_tool(name, arguments):
    if name != "status_rpg" or arguments:
        audit("invalid_call", "denied")
        return reply({"status": "denied"})
    result = await status()
    audit(name, result["status"], evidence=result)
    return reply(result)


async def run():
    audit("process", "started")
    async with stdio_server() as (reader, writer):
        await app.run(reader, writer, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(run())
