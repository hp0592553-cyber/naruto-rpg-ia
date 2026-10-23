"""noVNC protegido por HTTP Basic; nao publica CDP nem um proxy generico."""
import asyncio
import base64
import hmac
import os
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientSession, WSMsgType, web

PAGE = '''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Henrique — Naruto RPG</title><style>body{font:18px system-ui;background:#10151e;color:#eee;max-width:780px;margin:60px auto;padding:24px}a,button{display:inline-block;padding:14px;background:#e9a23b;color:#111;border:0;border-radius:8px;text-decoration:none;margin:10px 10px 10px 0}p{line-height:1.6}</style><h1>Henrique — Naruto RPG</h1><p>Abra a tela, entre no Discord e acesse o canal de comandos do Naruto Project. Resolva pessoalmente qualquer verificacao de login. Depois, volte aqui e libere o teste.</p><a href="/vnc.html?autoconnect=true&resize=scale&path=websockify" target="_blank" rel="noopener">Abrir tela Linux</a><form method="post" action="/ready"><button>Liberar teste unico /missoes minhas</button></form><form method="post" action="/finish"><button>Encerrar tela e salvar sessao</button></form><p>O agente aguarda sua liberacao. O link dura apenas enquanto esta execucao estiver ativa. Usuario: henrique. Senha: secret DESKTOP_PASSWORD.</p></html>'''


def create_app(password, ready_path, static_root='/usr/share/novnc', websocket_url='http://127.0.0.1:6081/websockify'):
    if len(password) < 16:
        raise ValueError('DESKTOP_PASSWORD deve ter pelo menos 16 caracteres')
    expected = ('henrique:' + password).encode()
    root = Path(static_root).resolve()

    @web.middleware
    async def auth(request, handler):
        supplied = request.headers.get('Authorization', '')
        try:
            raw = base64.b64decode(supplied[6:], validate=True) if supplied.startswith('Basic ') else b''
        except ValueError:
            raw = b''
        if not hmac.compare_digest(raw, expected):
            return web.Response(status=401, text='Autenticacao necessaria', headers={'WWW-Authenticate': 'Basic realm="Naruto Desktop", charset="UTF-8"', 'Cache-Control': 'no-store'})
        response = await handler(request)
        if not response.prepared:
            response.headers.update({'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY'})
        return response

    async def index(request):
        return web.Response(text=PAGE, content_type='text/html')

    async def ready(request):
        origin = request.headers.get('Origin', '')
        if not origin or urlsplit(origin).netloc != request.host:
            raise web.HTTPForbidden(text='Origem invalida')
        Path(ready_path).write_text('manual-login-confirmed\n')
        Path(ready_path).chmod(0o600)
        return web.Response(text='Teste liberado. Voce pode acompanhar pela tela. O resultado sera registrado no Actions.')

    async def finish(request):
        origin = request.headers.get('Origin', '')
        if not origin or urlsplit(origin).netloc != request.host:
            raise web.HTTPForbidden(text='Origem invalida')
        Path(str(ready_path) + '.finish').write_text('finish\n')
        return web.Response(text='Encerramento solicitado. O workflow salvara a sessao criptografada quando habilitada.')

    async def socket(request):
        origin = request.headers.get('Origin', '')
        if not origin or urlsplit(origin).netloc != request.host:
            raise web.HTTPForbidden(text='Origem invalida')
        ws = web.WebSocketResponse(protocols=('binary',), max_msg_size=16 * 1024 * 1024)
        async with ClientSession() as session:
            async with session.ws_connect(websocket_url, protocols=('binary',), max_msg_size=16 * 1024 * 1024) as upstream:
                await ws.prepare(request)
                async def pump(source, dest):
                    async for message in source:
                        if message.type == WSMsgType.BINARY:
                            await dest.send_bytes(message.data)
                        elif message.type == WSMsgType.TEXT:
                            await dest.send_str(message.data)
                        else:
                            break
                tasks = [asyncio.create_task(pump(ws, upstream)), asyncio.create_task(pump(upstream, ws))]
                try:
                    await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                finally:
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
                    await ws.close()
        return ws

    async def static(request):
        target = (root / request.match_info['path']).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(target)

    app = web.Application(middlewares=[auth])
    app.router.add_get('/', index)
    app.router.add_post('/ready', ready)
    app.router.add_post('/finish', finish)
    app.router.add_get('/websockify', socket)
    app.router.add_get('/{path:.*}', static)
    return app


if __name__ == '__main__':
    web.run_app(create_app(os.environ.get('DESKTOP_PASSWORD', ''), os.environ['RPG_DESKTOP_READY']), host='127.0.0.1', port=6080, print=None, access_log=None)
