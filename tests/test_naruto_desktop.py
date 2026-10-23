"""Testes locais, sem conta Discord, segredos reais ou chamadas externas."""
import asyncio
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import BasicAuth, web
from aiohttp.test_utils import TestClient, TestServer
from scripts.naruto_desktop_proxy import create_app
from scripts import naruto_browser_mcp as mcp


class DesktopProxyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)
        (self.path / 'vnc.html').write_text('synthetic novnc')
        self.ready = self.path / 'ready'
        self.client = TestClient(TestServer(create_app('test-only-password-12345', self.ready, self.path)))
        await self.client.start_server()
        self.auth = BasicAuth('henrique', 'test-only-password-12345')
        self.origin = str(self.client.make_url('/')).rstrip('/')

    async def asyncTearDown(self):
        await self.client.close()
        self.tmp.cleanup()

    async def test_all_routes_require_password(self):
        for path in ('/', '/vnc.html', '/websockify', '/json/version'):
            response = await self.client.get(path)
            self.assertEqual(response.status, 401)
        response = await self.client.post('/ready')
        self.assertEqual(response.status, 401)
        self.assertFalse(self.ready.exists())

    async def test_authenticated_static_and_manual_gate(self):
        response = await self.client.get('/vnc.html', auth=self.auth)
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.text(), 'synthetic novnc')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        response = await self.client.post('/ready', auth=self.auth, headers={'Origin': 'https://other.example'})
        self.assertEqual(response.status, 403)
        self.assertFalse(self.ready.exists())
        response = await self.client.post('/ready', auth=self.auth, headers={'Origin': self.origin})
        self.assertEqual(response.status, 200)
        self.assertTrue(self.ready.exists())
        response = await self.client.post('/finish', auth=self.auth, headers={'Origin': self.origin})
        self.assertEqual(response.status, 200)
        self.assertTrue(Path(str(self.ready) + '.finish').exists())

    async def test_cdp_and_parent_files_not_exposed(self):
        for path in ('/json/version', '/%2e%2e/outside', '/%2fetc/passwd'):
            response = await self.client.get(path, auth=self.auth)
            self.assertEqual(response.status, 404)

    async def test_websocket_binary_forwarding(self):
        async def echo(request):
            ws = web.WebSocketResponse(protocols=('binary',))
            await ws.prepare(request)
            async for msg in ws:
                await ws.send_bytes(msg.data)
            return ws
        app = web.Application()
        app.router.add_get('/websockify', echo)
        async with TestServer(app) as upstream:
            proxy = create_app('test-only-password-12345', self.ready, self.path, str(upstream.make_url('/websockify')))
            async with TestClient(TestServer(proxy)) as client:
                origin = str(client.make_url('/')).rstrip('/')
                ws = await client.ws_connect('/websockify', auth=self.auth, headers={'Origin': origin}, protocols=('binary',))
                await ws.send_bytes(b'synthetic-vnc-frame')
                response = await ws.receive(timeout=3)
                self.assertEqual(response.data, b'synthetic-vnc-frame')
                await ws.close()


class BrowserGuardTests(unittest.IsolatedAsyncioTestCase):
    def test_response_must_match_author_command_user_and_new_id(self):
        valid = {'id':'new', 'author_id':mcp.BOT, 'interaction':'Henrique usou /missoes minhas', 'text':'Nenhuma missao ativa'}
        self.assertTrue(mcp.bot_response(valid, {'old'}))
        self.assertFalse(mcp.bot_response(valid, {'new'}))
        self.assertFalse(mcp.bot_response({**valid, 'author_id':'other'}, set()))
        self.assertFalse(mcp.bot_response({**valid, 'interaction':'Outra pessoa usou /missoes minhas'}, set()))
        self.assertEqual(mcp.mission_state(valid['text']), 'no_active_missions')
        self.assertIsNone(mcp.mission_state('Resposta sem estado de missoes'))

    async def test_plain_text_is_never_sent_as_slash_command(self):
        editor = SimpleNamespace(inner_text=AsyncMock(return_value='/missoes minhas'), press=AsyncMock(),
                                 locator=lambda selector: SimpleNamespace(count=AsyncMock(return_value=0)))
        options = SimpleNamespace(nth=lambda n: SimpleNamespace(click=AsyncMock()))
        page = SimpleNamespace(locator=lambda selector: options)
        with patch.dict(os.environ, {'RPG_MODE':'jogar'}), patch.object(mcp,'page',page), patch.object(mcp,'picker',AsyncMock(return_value=([{'index':0}],editor))), patch.object(mcp,'messages',AsyncMock(return_value=[])):
            mcp.state['command_attempted'] = False
            result = await mcp.consult()
            self.assertEqual(result['status'], 'selected_command_not_confirmed')
            self.assertNotIn(unittest.mock.call('Enter'), editor.press.await_args_list)

    async def test_attempt_is_not_repeated_after_send_timeout(self):
        editor = SimpleNamespace(inner_text=AsyncMock(return_value='/missoes minhas'), press=AsyncMock(side_effect=TimeoutError()),
                                 locator=lambda selector: SimpleNamespace(count=AsyncMock(return_value=1)))
        page = SimpleNamespace(locator=lambda selector: SimpleNamespace(nth=lambda n: SimpleNamespace(click=AsyncMock())))
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'RPG_MODE':'jogar','RPG_ACTION_MARKER':directory+'/reserved'}), patch.object(mcp,'page',page), patch.object(mcp,'picker',AsyncMock(return_value=([{'index':0}],editor))), patch.object(mcp,'messages',AsyncMock(return_value=[])):
            mcp.state['command_attempted'] = False
            with self.assertRaises(TimeoutError):
                await mcp.consult()
            self.assertTrue(Path(directory+'/reserved').exists())
            result = await mcp.consult()
            self.assertEqual(result['status'], 'blocked_already_attempted')
            self.assertEqual(editor.press.await_count, 1)
            mcp.state['command_attempted'] = False


if __name__ == '__main__':
    unittest.main()
