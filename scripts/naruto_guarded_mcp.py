#!/usr/bin/env python3
"""MCP de escopo minimo para testar Naruto Project com uma conta propria.

ATENCAO: self-bots violam as regras do Discord e podem suspender a conta.
Apenas os canais e comandos explicitamente permitidos sao expostos ao agente.
Nunca grave ou imprima DISCORD_TOKEN.
"""

import asyncio
import json
import os
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from discord_py_self_mcp.bot import client
from discord_py_self_mcp.tools import registry

GUILD_ID = 1515877468299595919
NARUTO_BOT_ID = "1515908078913192026"
ALLOWED_CHANNELS = {"1520114348079583263", "1520114532511387729"}
ALLOWED_COMMANDS = {"recompensa-diaria"}
MODE = os.getenv("RPG_MODE", "verificar").lower()
AUDIT = os.getenv("RPG_AUDIT_PATH", "")
MAX_MESSAGES = 12

READ_TOOLS = {"read_messages", "list_application_commands", "list_ephemeral_messages"}
WRITE_TOOLS = {"send_slash_command"} if MODE == "jogar" else set()
TOOLS = READ_TOOLS | WRITE_TOOLS
app = Server("naruto-rpg-guardado")
actions_used = 0


def reply(message: str):
    return [TextContent(type="text", text=message)]


def audit(tool: str, outcome: str, **details):
    if not AUDIT:
        return
    try:
        entry = {"tool": tool, "outcome": outcome, **details}
        with Path(AUDIT).open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass


async def wait_ready():
    if client.is_ready():
        return True
    try:
        await asyncio.wait_for(client.wait_until_ready(), timeout=35)
        return client.is_ready()
    except (asyncio.TimeoutError, RuntimeError):
        return False


@app.list_tools()
async def list_tools() -> list[Tool]:
    definitions = [
        Tool(
            name="status_rpg",
            description="Confirma a conexao a conta e ao servidor Naruto Project, sem modificar nada.",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]
    definitions.extend(t for t in registry.get_tool_definitions() if t.name in TOOLS)
    return definitions


@app.call_tool()
async def call_tool(name: str, arguments: dict):
    global actions_used
    if name != "status_rpg" and name not in TOOLS:
        return reply("Ferramenta indisponivel para este modo.")
    if not await wait_ready():
        audit(name, "not_ready")
        return reply("Discord nao ficou pronto; nao foi executada nenhuma jogada.")

    guild = client.get_guild(GUILD_ID)
    if guild is None:
        audit(name, "wrong_guild")
        return reply("Conta conectada, mas servidor Naruto Project nao foi encontrado.")

    if name == "status_rpg":
        audit(name, "ok")
        account = str(client.user) if client.user else "indisponivel"
        return reply(f"Discord conectado: {account}. Servidor: {guild.name}. Modo: {MODE}.")

    params = dict(arguments or {})
    channel_id = str(params.get("channel_id", "")).strip()
    if channel_id not in ALLOWED_CHANNELS:
        audit(name, "channel_denied")
        return reply("Acesso negado: canal fora da lista do Naruto RPG.")

    channel = client.get_channel(int(channel_id))
    if channel is None:
        try:
            channel = await client.fetch_channel(int(channel_id))
        except Exception:
            audit(name, "channel_error")
            return reply("Canal indisponivel, sem executar nenhuma acao.")
    server = getattr(channel, "guild", None)
    if getattr(server, "id", None) != GUILD_ID:
        audit(name, "wrong_server")
        return reply("Acesso negado: canal nao pertence ao Naruto Project.")

    params["channel_id"] = channel_id
    if name in {"read_messages", "list_ephemeral_messages"}:
        try:
            asked = int(params.get("limit", MAX_MESSAGES))
        except (ValueError, TypeError):
            asked = MAX_MESSAGES
        params["limit"] = max(1, min(MAX_MESSAGES, asked))
    if name == "list_application_commands":
        params["kind"] = "slash"

    if name == "send_slash_command":
        command = str(params.get("command_name", "")).strip().lstrip("/").lower()
        if actions_used >= 1 or command not in ALLOWED_COMMANDS or params.get("options"):
            audit(name, "action_denied", command=command)
            return reply("Acao bloqueada: somente uma /recompensa-diaria sem opcoes por execucao.")
        if str(params.get("application_id", NARUTO_BOT_ID)) != NARUTO_BOT_ID:
            audit(name, "wrong_bot")
            return reply("Acao bloqueada: aplicativo nao e o Naruto Bot.")
        # Reserva a unica tentativa ANTES de chamar a API: nunca repetir por timeout.
        actions_used += 1
        params["command_name"] = command
        params["application_id"] = NARUTO_BOT_ID

    try:
        result = await registry.call_tool(name, params)
        outcome = "ok"
        if name == "send_slash_command":
            combined = " ".join(getattr(part, "text", "") for part in result)
            outcome = "submitted" if "Executed slash command:" in combined else "not_confirmed"
        audit(name, outcome, channel_id=channel_id,
              **({"command": params["command_name"]} if name == "send_slash_command" else {}))
        return result
    except Exception as exc:
        audit(name, "error", channel_id=channel_id)
        return reply(f"Ferramenta falhou ({type(exc).__name__}). Nenhuma recompensa confirmada.")


async def run():
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise SystemExit("DISCORD_TOKEN ausente. Defina o secret no GitHub Actions.")
    discord_task = asyncio.create_task(client.start(token))
    try:
        async with stdio_server() as (reader, writer):
            await app.run(reader, writer, app.create_initialization_options())
    finally:
        await client.close()
        discord_task.cancel()
        await asyncio.gather(discord_task, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(run())
