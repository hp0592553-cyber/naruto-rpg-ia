#!/usr/bin/env python3
"""MCP de interface: so o canal Naruto Project, sem token ou API Discord."""
import asyncio
import base64
import json
import os
from pathlib import Path
import re
import time
import unicodedata
from urllib.parse import urlsplit

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import ImageContent, TextContent, Tool
from playwright.async_api import async_playwright

GUILD = '1515877468299595919'
CHANNEL = '1520114348079583263'
BOT = '1515908078913192026'
TARGET = f'https://discord.com/channels/{GUILD}/{CHANNEL}'
app = Server('naruto-rpg-browser')
pw = None
browser = None
page = None
state = {'character_connected': False, 'command_attempted': False, 'command_sent': False,
         'command_completed': False, 'rpg_state_verified': False, 'transport': 'browser_ui'}


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))


def audit(tool, outcome, **details):
    if os.getenv('RPG_AUDIT_PATH'):
        with Path(os.environ['RPG_AUDIT_PATH']).open('a') as out:
            out.write(json.dumps({'time': time.time(), 'phase': os.getenv('RPG_PHASE', 'unknown'),
                                 'tool': tool, 'outcome': outcome, **details}, ensure_ascii=False) + '\n')


async def get_page():
    global pw, browser, page
    if pw is None:
        pw = await async_playwright().start()
        browser = await pw.chromium.connect_over_cdp('http://127.0.0.1:9222', timeout=30000)
    if page is None or page.is_closed():
        candidates = [p for c in browser.contexts for p in c.pages if urlsplit(p.url).hostname == 'discord.com']
        if not candidates:
            return None
        # Nunca examinar paginas de outros sites ou abas de autenticacao do ChatGPT.
        page = next((p for p in candidates if p.url.split('?')[0] == TARGET), candidates[0])
    return page


async def status():
    p = await get_page()
    if p is None:
        return {**state, 'character_connected': False, 'channel_accessed': False, 'status': 'discord_page_not_open'}
    parsed = urlsplit(p.url)
    if parsed.hostname != 'discord.com' or parsed.path != f'/channels/{GUILD}/{CHANNEL}':
        return {**state, 'character_connected': False, 'channel_accessed': False, 'status': 'manual_login_or_correct_channel_required'}
    chat = p.locator('[data-list-id="chat-messages"]')
    editor = p.locator('[role="textbox"][contenteditable="true"]').last
    if not await chat.count() or not await editor.count():
        return {**state, 'character_connected': False, 'channel_accessed': False, 'status': 'channel_ui_not_ready'}
    identity = p.locator('section[aria-label="User area"], section[aria-label="Área do usuário"], section[aria-label="Área de usuário"]')
    if not await identity.count():
        return {**state, 'character_connected': False, 'status': 'account_identity_not_visible'}
    account_label = (await identity.first.inner_text()).strip()
    if 'henrique' not in normalized(account_label):
        return {**state, 'character_connected': False, 'status': 'wrong_account_visible'}
    state['observed_account_label'] = account_label[:150]
    # Estado autenticado da UI, nao uma afirmacao de nivel/XP ou ficha do personagem.
    state.update(character_connected=True, channel_accessed=True, guild_accessed=True, guild_id=GUILD, channel_id=CHANNEL)
    return {**state, 'status': 'connected'}


async def messages():
    p = await get_page()
    return await p.locator('[data-list-id="chat-messages"] li[id^="chat-messages-"]').evaluate_all('''rows => rows.slice(-12).map(row => ({
        id: row.id, text: row.innerText,
        author_id: row.getAttribute('data-author-id') || row.querySelector('[data-author-id]')?.getAttribute('data-author-id') || '',
        avatar: row.querySelector('img[src*="/avatars/"]')?.getAttribute('src') || '',
        interaction: Array.from(row.querySelectorAll('[class*="interaction"]')).map(el=>el.innerText).join(' ')
    }))''')


def bot_response(row, previous_ids):
    if row['id'] in previous_ids:
        return False
    author_ok = row.get('author_id') == BOT or f'/avatars/{BOT}/' in row.get('avatar', '')
    context = normalized(row.get('interaction', ''))
    # Exigir correlacao visivel com Henrique e o comando; mensagem nova sozinha nao basta.
    return author_ok and 'henrique' in context and 'missoes' in context and 'minhas' in context


def mission_state(text):
    text = normalized(text)
    if re.search(r'nenhum[ao]s? miss|nao (?:tem|possui).*miss', text):
        return 'no_active_missions'
    if 'miss' in text and any(word in text for word in ('andamento', 'ativa', 'rank', 'concluida')):
        return 'missions_listed'
    return None


async def snapshot(name):
    if not os.getenv('RPG_EVIDENCE_DIR'):
        return None
    destination = Path(os.environ['RPG_EVIDENCE_DIR']) / (name + '.png')
    p = await get_page()
    # Recortar somente o chat autenticado, nunca a tela de login/senhas.
    image = await p.locator('[data-list-id="chat-messages"]').screenshot(path=str(destination))
    return ImageContent(type='image', mimeType='image/png', data=base64.b64encode(image).decode())


async def picker():
    p = await get_page()
    editor = p.locator('[role="textbox"][contenteditable="true"]').last
    # Nao sobrescrever uma mensagem que o usuario esteja digitando.
    existing = (await editor.inner_text()).strip()
    if existing and normalized(existing) != '/missoes minhas':
        return [], None
    await editor.fill('/missoes minhas')
    await asyncio.sleep(2)
    options = p.locator('[role="option"]:visible')
    entries = []
    for i in range(await options.count()):
        text = await options.nth(i).inner_text()
        check = normalized(text)
        if 'missoes' in check and 'minhas' in check and 'naruto' in check:
            entries.append({'index': i, 'text': text[:1000]})
    return entries, editor


async def discover():
    entries, editor = await picker()
    if editor is not None:
        await editor.press('Escape')
        await editor.fill('')
    return {**state, 'status': 'commands_discovered', 'mission_command_available': len(entries) == 1,
            'picker_matches': entries, 'reason': 'Somente uma opcao visivel de /missoes minhas do Naruto Bot e aceita.'}


async def consult():
    if os.getenv('RPG_MODE') != 'jogar':
        return {**state, 'status': 'blocked_read_only'}
    if state['command_attempted']:
        return {**state, 'status': 'blocked_already_attempted'}
    entries, editor = await picker()
    if len(entries) != 1 or editor is None:
        return {**state, 'status': 'command_picker_not_unambiguous'}
    before = await messages()
    previous = {r['id'] for r in before}
    # Selecionar o slash command real; texto comum nunca e enviado como substituto.
    await page.locator('[role="option"]:visible').nth(entries[0]['index']).click()
    await asyncio.sleep(0.5)
    rendered = normalized(await editor.inner_text())
    chips = await editor.locator('[data-slate-inline="true"], [class*="commandName"]').count()
    if not chips or 'missoes' not in rendered or 'minhas' not in rendered:
        await editor.press('Escape')
        return {**state, 'status': 'selected_command_not_confirmed'}
    try:
        with Path(os.environ['RPG_ACTION_MARKER']).open('x') as out:
            out.write('reserved browser /missoes minhas\n')
    except FileExistsError:
        return {**state, 'status': 'blocked_run_already_attempted'}
    state['command_attempted'] = True
    audit('command_attempt', 'reserved', evidence=dict(state))
    # O unico Enter de envio existe aqui. Nenhuma repeticao apos erro/timeout.
    await editor.press('Enter')
    state['submission_key_pressed'] = True
    audit('command_send', 'enter_pressed_unconfirmed', evidence=dict(state))
    deadline = time.monotonic() + 180
    candidates = []
    while time.monotonic() < deadline:
        await asyncio.sleep(2)
        if (await status())['status'] != 'connected':
            return {**state, 'status': 'channel_changed_after_attempt'}
        candidates = [row for row in await messages() if row['id'] not in previous]
        for row in candidates:
            if bot_response(row, previous):
                observed = mission_state(row['text'])
                state.update(command_sent=True, command_completed=True, rpg_state_verified=observed is not None,
                             response=row, observed_mission_state=observed)
                await snapshot('resposta-naruto')
                return {**state, 'status': 'response_received'}
    await snapshot('apos-tentativa-nao-confirmada')
    return {**state, 'status': 'response_not_correlated', 'new_visible_messages': candidates}


@app.list_tools()
async def list_tools():
    audit('list_tools', 'ok')
    descriptions = {'status_rpg': 'Confere a interface do canal exato do Naruto Project; nao usa tokens.',
        'read_messages': 'Le ate 12 mensagens visiveis do canal e captura imagem do chat.',
        'list_application_commands': 'Confere o menu visual de /missoes minhas do Naruto Bot, sem enviar.',
        'consult_missions': 'Seleciona o slash command real e tenta UMA /missoes minhas; aguarda evidencia correlacionada.'}
    return [Tool(name=n, description=d, inputSchema={'type':'object','properties':{},'additionalProperties':False}) for n,d in descriptions.items()]


@app.call_tool()
async def call_tool(name, arguments):
    image = None
    if name not in {'status_rpg', 'read_messages', 'list_application_commands', 'consult_missions'} or arguments:
        return [TextContent(type='text', text='{"status":"denied"}')]
    try:
        result = await status()
        if result['status'] == 'connected':
            if name == 'read_messages':
                result = {**state, 'status': 'history_read', 'messages': await messages()}
                image = await snapshot('canal-lido')
            elif name == 'list_application_commands':
                result = await discover()
            elif name == 'consult_missions':
                result = await consult()
        audit(name, result['status'], evidence=result)
    except Exception as exc:
        result = {**state, 'character_connected': False, 'status': 'browser_tool_failed', 'error_type': type(exc).__name__}
        audit(name, result['status'], evidence=result)
    content = [TextContent(type='text', text=json.dumps(result, ensure_ascii=False))]
    return content + ([image] if image else [])


async def run():
    audit('process', 'started')
    try:
        async with stdio_server() as (reader, writer):
            await app.run(reader, writer, app.create_initialization_options())
    finally:
        # Encerrar so a conexao Playwright, preservando o Chromium visivel do usuario.
        if pw is not None:
            await pw.stop()


if __name__ == '__main__':
    asyncio.run(run())
