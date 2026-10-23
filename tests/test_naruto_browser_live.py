"""Chromium real + UI sintetica interceptada localmente; nunca acessa Discord."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from playwright.async_api import async_playwright
from scripts import naruto_browser_mcp as mcp

FIXTURE = '''<!doctype html><html><body><section aria-label="User area">Henrique</section><ol data-list-id="chat-messages"><li id="chat-messages-old" data-author-id="1515908078913192026">Mensagem antiga sintetica</li></ol>
<div role="textbox" contenteditable="true"></div><button role="option" style="display:none">Naruto Bot /missoes minhas</button>
<script>
const editor=document.querySelector('[role=textbox]');
const option=document.querySelector('[role=option]');
window.sentCount=0;
editor.addEventListener('input',()=>{option.style.display=editor.innerText.includes('/missoes minhas')?'block':'none'});
option.onclick=()=>{editor.innerHTML='<span data-slate-inline="true" contenteditable="false">/missoes minhas</span>';option.style.display='none'};
editor.addEventListener('keydown',event=>{if(event.key==='Enter'){
 event.preventDefault();window.sentCount++;
 const row=document.createElement('li');row.id='chat-messages-new';row.dataset.authorId='1515908078913192026';
 row.innerHTML='<div class="interaction">Henrique usou /missoes minhas</div><p>Nenhuma missao ativa</p>';
 document.querySelector('ol').appendChild(row);editor.innerHTML='';
}});
</script></body></html>'''


class RealBrowserFixtureTests(unittest.IsolatedAsyncioTestCase):
    async def test_scoped_ui_command_and_response(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'RPG_ACTION_MARKER':directory+'/reserved', 'RPG_MODE':'jogar',
            'RPG_EVIDENCE_DIR':directory, 'RPG_AUDIT_PATH':directory+'/audit.jsonl'}):
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, args=['--remote-debugging-port=9222','--remote-debugging-address=127.0.0.1'])
                context = await browser.new_context()
                await context.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body=FIXTURE))
                page = await context.new_page()
                await page.goto(mcp.TARGET)
                mcp.pw = mcp.browser = mcp.page = None
                mcp.state.update(command_attempted=False,command_sent=False,command_completed=False,rpg_state_verified=False)
                try:
                    self.assertEqual((await mcp.status())['status'],'connected')
                    response = await mcp.call_tool('read_messages', {})
                    self.assertEqual(json.loads(response[0].text)['messages'][0]['id'], 'chat-messages-old')
                    self.assertTrue(Path(directory,'canal-lido.png').is_file())
                    self.assertTrue((await mcp.discover())['mission_command_available'])
                    result = await mcp.consult()
                    self.assertTrue(result['command_completed'])
                    self.assertTrue(result['rpg_state_verified'])
                    self.assertEqual(result['observed_mission_state'],'no_active_missions')
                    self.assertEqual(await page.evaluate('window.sentCount'),1)
                    self.assertEqual((await mcp.consult())['status'],'blocked_already_attempted')
                    self.assertEqual(await page.evaluate('window.sentCount'),1)
                    # A mudanca de canal bloqueia a leitura subsequente.
                    await page.goto('https://discord.com/channels/other/other')
                    self.assertEqual((await mcp.status())['status'],'manual_login_or_correct_channel_required')
                finally:
                    if mcp.pw:
                        await mcp.pw.stop()
                    mcp.pw = mcp.browser = mcp.page = None
                    await browser.close()


if __name__ == '__main__':
    unittest.main()
