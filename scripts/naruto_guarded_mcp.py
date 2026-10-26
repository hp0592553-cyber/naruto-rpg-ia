#!/usr/bin/env python3
"""MCP restrito ao Naruto Project; sem solver CAPTCHA ou ferramentas genericas."""
import asyncio
import inspect
import json
import math
import re
import os
from datetime import datetime, timezone
from pathlib import Path

import discord
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

GUILD_ID = 1515877468299595919
CHANNEL_ID = 1520114348079583263
NARUTO_BOT_ID = 1515908078913192026
app = Server('naruto-rpg-guardado')
class RestrictedClient(discord.Client):
    receiver = None
    raw_messages = None

    async def on_socket_raw_receive(self, payload):
        # Keep Components V2 even when the installed model cannot deserialize them.
        if not isinstance(payload, str):
            return
        try:
            event = json.loads(payload)
        except (ValueError, TypeError):
            return
        if event.get('t') not in {'MESSAGE_CREATE', 'MESSAGE_UPDATE'}:
            return
        data = event.get('d') or {}
        if str(data.get('channel_id', '')) != str(CHANNEL_ID) or not data.get('id'):
            return
        if self.raw_messages is None:
            self.raw_messages = {}
        key = str(data['id'])
        self.raw_messages[key] = {**self.raw_messages.get(key, {}), **data}
        while len(self.raw_messages) > 32:
            self.raw_messages.pop(next(iter(self.raw_messages)))

    async def on_message(self, message):
        if self.receiver:
            await self.receiver(message)

    async def on_message_edit(self, before, after):
        if self.receiver:
            await self.receiver(after)


client = RestrictedClient(enable_debug_events=True)
connection = None
channel = None
commands = []
state = {'character_connected': False, 'command_attempted': False, 'command_sent': False,
         'command_completed': False, 'rpg_state_verified': False}


def audit(tool, outcome, **details):
    path = os.getenv('RPG_AUDIT_PATH')
    if path:
        with Path(path).open('a', encoding='utf-8') as handle:
            handle.write(json.dumps({'time': datetime.now(timezone.utc).isoformat(),
                'phase': os.getenv('RPG_PHASE', 'unknown'), 'tool': tool, 'outcome': outcome, **details}, ensure_ascii=False) + '\n')


def safe_error(exc):
    # Nunca registrar str(exc): respostas HTTP podem conter dados de autenticacao.
    return {'error_type': type(exc).__name__, 'http_status': getattr(exc, 'status', None)}


def reply(data):
    return [TextContent(type='text', text=json.dumps(data, ensure_ascii=False))]


async def collect(value):
    if inspect.isawaitable(value):
        value = await value
    return [item async for item in value] if hasattr(value, '__aiter__') else list(value)


async def status():
    global connection, channel
    token = os.getenv('DISCORD_USER_TOKEN', '')
    if not token:
        return {**state, 'status': 'blocked_missing_user_token'}
    if connection is None:
        # Sem reconexao automatica, resolucao de CAPTCHA ou login alternativo.
        connection = asyncio.create_task(client.start(token, reconnect=False))
        for _ in range(120):
            if connection.done():
                try:
                    connection.result()
                except Exception as exc:
                    return {**state, 'status': 'discord_login_failed', **safe_error(exc)}
                return {**state, 'status': 'discord_disconnected'}
            if client.is_ready():
                break
            await asyncio.sleep(0.5)
    if not client.is_ready():
        return {**state, 'status': 'discord_not_ready'}
    if getattr(client.user, 'bot', False):
        return {**state, 'status': 'wrong_identity_bot'}
    if client.user.id != 481485837801095178:
        return {**state, 'status': 'wrong_account'}
    guild = client.get_guild(GUILD_ID)
    if guild is None:
        return {**state, 'status': 'guild_not_accessible', 'account_id': str(client.user.id)}
    try:
        channel = client.get_channel(CHANNEL_ID) or await client.fetch_channel(CHANNEL_ID)
    except Exception as exc:
        return {**state, 'status': 'channel_not_accessible', **safe_error(exc)}
    if getattr(getattr(channel, 'guild', None), 'id', None) != GUILD_ID:
        return {**state, 'status': 'wrong_guild'}
    member = guild.get_member(client.user.id)
    name = getattr(member, 'display_name', '')
    # O apelido e evidencia de identidade declarada; nao comprova estado do RPG.
    state.update(character_connected=True, account_id=str(client.user.id), guild_id=str(GUILD_ID),
                 channel_id=str(CHANNEL_ID), guild_accessed=True, channel_accessed=True, display_name=name)
    return {**state, 'status': 'connected'}


def message_data(message):
    metadata = getattr(message, 'interaction', None) or getattr(message, 'interaction_metadata', None)
    user = getattr(metadata, 'user', None)
    raw = (client.raw_messages or {}).get(str(message.id), {})
    return {'message_id': str(message.id), 'author_id': str(message.author.id),
            'channel_id': str(message.channel.id), 'content': message.content,
            'timestamp': message.created_at.isoformat(), 'flags': message.flags.value,
            'embeds': [embed.to_dict() for embed in message.embeds],
            'components': raw.get('components', [component.to_dict() for component in getattr(message, 'components', [])]),
            'attachments': [attachment.to_dict() for attachment in message.attachments],
            'interaction_metadata': {'id': str(getattr(metadata, 'id', '')),
                'user_id': str(getattr(user, 'id', ''))},
            'ephemeral': bool(getattr(message.flags, 'ephemeral', False))}


@app.list_tools()
async def list_tools():
    audit('list_tools', 'ok')
    descriptions = {'status_rpg': 'Verifica login da conta autorizada, servidor e canal exatos.',
                    'read_messages': 'Le ate 12 mensagens do canal fixo Naruto Project.',
                    'list_application_commands': 'Descobre comandos do Naruto Bot no canal fixo.',
                    'consult_missions': 'Tenta UMA /missoes minhas e aguarda resposta correlacionada. Nunca repetir.'}
    return [Tool(name=name, description=description, inputSchema={'type': 'object', 'properties': {}, 'additionalProperties': False})
            for name, description in descriptions.items()]


async def discover(command_path="missoes minhas"):
    parts = command_path.lstrip("/").split()
    global commands
    commands = [cmd for cmd in await collect(channel.application_commands())
                if isinstance(cmd, discord.SlashCommand) and cmd.application_id == NARUTO_BOT_ID]
    roots = [c for c in commands if c.name == parts[0]]
    scoped = [c for c in roots if getattr(c, 'guild_id', None) == GUILD_ID]
    roots = scoped or roots
    if len(roots) != 1:
        return None
    target = roots[0]
    for part in parts[1:]:
        target = next((c for c in getattr(target, 'children', []) if c.name == part), None)
        if target is None:
            return None
    if getattr(target, 'children', []):
        return None
    return target



def prepare_options(command, options):
    """Validate against the real catalog before reserving or sending an action."""
    known = {o.name: o for o in getattr(command, 'options', [])}
    if set(options) - set(known):
        raise ValueError('unknown_options')
    if any(getattr(o, 'required', False) and name not in options for name, o in known.items()):
        raise ValueError('missing_options')
    prepared = {}
    for name, value in options.items():
        opt = known[name]
        kind = getattr(opt.type, 'value', opt.type)
        if kind in (6, 7, 8, 9):
            if not isinstance(value, str):
                raise ValueError('invalid_id')
            match = re.fullmatch(r'(?:<@!?([0-9]{15,22})>|<@&([0-9]{15,22})>|<#([0-9]{15,22})>|([0-9]{15,22}))', value.strip())
            if not match:
                raise ValueError('invalid_id')
            value = discord.Object(id=int(next(v for v in match.groups() if v)))
        elif kind == 3:
            if not isinstance(value, str) or len(value) > 2000:
                raise ValueError('invalid_string')
        elif kind == 5:
            if type(value) is not bool:
                raise ValueError('invalid_boolean')
        elif kind in (4, 10):
            if type(value) not in (int, float) or not math.isfinite(value) or (kind == 4 and value != int(value)):
                raise ValueError('invalid_number')
            for attr, invalid in [('min_value', lambda v: value < v), ('max_value', lambda v: value > v)]:
                limit = getattr(opt, attr, None)
                if limit is not None and invalid(limit):
                    raise ValueError('out_of_range')
            if kind == 4:
                value = int(value)
        else:
            raise ValueError('unsupported_option_type')
        choices = getattr(opt, 'choices', [])
        if choices and not any(value == c.value and type(value) is type(c.value) for c in choices):
            raise ValueError('invalid_choice')
        prepared[name] = value
    return prepared


async def consult(command_path="missoes minhas", options=None):
    options = options or {}
    if state['command_attempted']:
        return {**state, 'status': 'blocked_already_attempted'}
    command = await discover(command_path)
    if command is None:
        return {**state, 'status': 'command_not_found'}
    known = {o.name: o for o in getattr(command, 'options', [])}
    if set(options) - set(known):
        return {**state, 'status': 'unknown_options'}
    missing = [name for name, opt in known.items() if getattr(opt, 'required', False) and name not in options]
    if missing:
        return {**state, 'status': 'missing_options', 'missing': missing}
    try:
        prepared = prepare_options(command, options)
    except ValueError as exc:
        return {**state, 'status': 'invalid_options', 'validation': str(exc)}
    if os.getenv('RPG_MODE') != 'jogar':
        return {**state, 'status': 'blocked_read_only'}
    marker = Path(os.environ['RPG_ACTION_MARKER'])
    try:
        with marker.open('x') as handle:
            handle.write('reserved /' + command_path.lstrip('/') + '\n')
    except FileExistsError:
        return {**state, 'status': 'blocked_run_already_attempted'}
    state['command_attempted'] = True
    audit('command_attempt', 'reserved', command=command_path)
    # O listener existe antes do envio. Mensagem anterior ou de outro usuario nao conta.
    received = asyncio.Queue()
    baseline = discord.utils.time_snowflake(datetime.now(timezone.utc))
    async def on_message(message):
        if message.channel.id == CHANNEL_ID and message.author.id == NARUTO_BOT_ID and message.id > baseline:
            await received.put(message)
    client.receiver = on_message
    try:
        interaction = await asyncio.wait_for(command(channel, **prepared), timeout=45)
        interaction_id = getattr(interaction, 'id', None)
        state.update(command_sent=True, interaction_id=str(interaction_id) if interaction_id else None)
        audit('command_send', 'submitted', evidence=dict(state))
        deadline = asyncio.get_running_loop().time() + 35
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            try:
                msg = await asyncio.wait_for(received.get(), timeout=remaining)
            except asyncio.TimeoutError:
                break
            metadata = getattr(msg, 'interaction', None) or getattr(msg, 'interaction_metadata', None)
            if getattr(msg.flags, 'loading', False):
                continue
            if interaction_id and getattr(metadata, 'id', None) == interaction_id:
                response = message_data(msg)
                if not any(response.get(key) for key in ('content', 'embeds', 'components', 'attachments')):
                    continue
                state.update(command_completed=True, response=response)
                # Conteudo capturado e verificavel; nao inferir XP/nivel automaticamente.
                return {**state, 'status': 'response_received', 'rpg_state_verified': False}
        return {**state, 'status': 'submitted_response_not_correlated'}
    finally:
        client.receiver = None


@app.call_tool()
async def call_tool(name, arguments):
    if arguments or name not in {'status_rpg', 'read_messages', 'list_application_commands', 'consult_missions'}:
        return reply({'status': 'denied'})
    try:
        result = await status()
        if result['status'] == 'connected':
            if name == 'read_messages':
                result = {**state, 'status': 'history_read', 'messages': [message_data(m) async for m in channel.history(limit=12)]}
            elif name == 'list_application_commands':
                target = await discover()
                result = {**state, 'status': 'commands_discovered', 'mission_command_available': target is not None,
                          'commands': [{'name': c.name, 'id': str(c.id), 'application_id': str(c.application_id)} for c in commands]}
            elif name == 'consult_missions':
                result = await consult()
        audit(name, result['status'], evidence=result)
        return reply(result)
    except Exception as exc:
        result = {**state, 'status': 'tool_failed', **safe_error(exc)}
        audit(name, result['status'], evidence=result)
        return reply(result)


async def run():
    audit('process', 'started')
    try:
        async with stdio_server() as (reader, writer):
            await app.run(reader, writer, app.create_initialization_options())
    finally:
        await client.close()
        if connection:
            connection.cancel()
            await asyncio.gather(connection, return_exceptions=True)


if __name__ == '__main__':
    asyncio.run(run())

