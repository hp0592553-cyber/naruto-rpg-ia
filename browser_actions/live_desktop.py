#!/usr/bin/env python3
"""Temporary Bushin desktop on a GitHub Actions runner. The link is a secret."""
import asyncio
import hmac
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlsplit

from aiohttp import web, ClientSession, ClientTimeout, WSMsgType

DISPLAY = ":99"
PORT = 8787
BACKEND = "http://127.0.0.1:6081"
VNC_DIR = "/usr/share/novnc"
LOGIN_URL = "https://discord.com/login?redirect_to=%2Fstore"
MAX_SECONDS = 345 * 60

LOGIN_HTML = """<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bushin — acesso protegido</title>
  <style>
    body { background:#0d1425; color:#f5f6fb; font:16px system-ui,sans-serif; margin:0; min-height:100vh; display:grid; place-items:center; }
    main { box-sizing:border-box; width:min(420px,calc(100vw - 32px)); padding:28px; border:1px solid #334155; border-radius:16px; background:#182234; }
    h1 { font-size:1.5rem; margin:0 0 14px; } p { line-height:1.55; color:#cbd5e1; }
    label { display:block; font-weight:600; margin:18px 0 8px; }
    input { box-sizing:border-box; width:100%; padding:12px; border-radius:8px; border:1px solid #64748b; background:#0d1425; color:white; }
    button { margin-top:16px; width:100%; padding:13px; border:0; border-radius:8px; background:#f97316; color:#111827; font-weight:700; cursor:pointer; }
    small { display:block; margin-top:18px; color:#94a3b8; line-height:1.5; }
  </style>
</head>
<body><main>
  <h1>🍥 Bushin Linux — entrada segura</h1>
  <p>O visualizador está disponível pela internet, mas o desktop só abre após autenticação.</p>
  <form method="post" action="/login">
    <label for="access_key">Chave de acesso da execução</label>
    <input id="access_key" name="access_key" type="password" required autocomplete="off" autofocus>
    <button type="submit">Entrar no desktop</button>
  </form>
  <small>Você também pode abrir o link privado no resumo da execução do GitHub Actions para entrar automaticamente. Não compartilhe a chave.</small>
</main></body></html>"""

LOGIN_HEADERS = {
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
}

def safe_equal(left, right):
    return isinstance(left, str) and hmac.compare_digest(left.encode(), right.encode())

def make_app(secret):
    app = web.Application(client_max_size=1024 * 1024)
    app["secret"] = secret
    # Mutable holder: populated once Cloudflare provides the real public HTTPS origin.
    app["public_origin"] = {"url": None}

    def authenticated_redirect():
        response = web.HTTPFound("/vnc.html?autoconnect=1&resize=scale")
        response.set_cookie(
            "bushin_session", secret, max_age=MAX_SECONDS,
            secure=True, httponly=True, samesite="Lax", path="/")
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    async def handler(request):
        if request.path == "/connect" and request.method == "GET":
            supplied = request.query.get("key", "")
            if not safe_equal(supplied, secret):
                return web.Response(status=403, text="Acesso negado", headers=LOGIN_HEADERS)
            return authenticated_redirect()

        if request.path == "/login" and request.method == "POST":
            # Origin prevents another website from silently submitting a login.
            # The tunnel may forward a local Host header, so validate against
            # the exact HTTPS origin Cloudflare assigned instead of request.host.
            expected_origin = app["public_origin"]["url"] or "https://" + request.host
            if request.headers.get("Origin") != expected_origin:
                return web.Response(status=403, text="Origem nao autorizada", headers=LOGIN_HEADERS)
            form = await request.post()
            if not safe_equal(form.get("access_key", ""), secret):
                return web.Response(status=403, text="Chave invalida", headers=LOGIN_HEADERS)
            return authenticated_redirect()

        if not safe_equal(request.cookies.get("bushin_session", ""), secret):
            # Public landing page ONLY. No VNC assets, WebSocket or desktop pixels
            # are served without the private per-run secret.
            if request.method == "GET" and request.path in ("/", "/vnc.html"):
                return web.Response(text=LOGIN_HTML, content_type="text/html",
                                    headers=LOGIN_HEADERS)
            return web.Response(status=403, text="Autenticacao obrigatoria",
                                headers=LOGIN_HEADERS)

        if request.path == "/":
            raise web.HTTPFound("/vnc.html?autoconnect=1&resize=scale")

        if request.headers.get("Upgrade", "").lower() == "websocket":
            frontend = web.WebSocketResponse(heartbeat=25, max_msg_size=16 * 1024 * 1024)
            await frontend.prepare(request)
            upstream_url = BACKEND.replace("http://", "ws://") + str(request.rel_url)
            try:
                async with ClientSession() as session:
                    async with session.ws_connect(upstream_url, heartbeat=25, max_msg_size=16 * 1024 * 1024) as backend:
                        async def forward_front():
                            async for message in frontend:
                                if message.type == WSMsgType.BINARY:
                                    await backend.send_bytes(message.data)
                                elif message.type == WSMsgType.TEXT:
                                    await backend.send_str(message.data)
                                else:
                                    break
                        async def forward_back():
                            async for message in backend:
                                if message.type == WSMsgType.BINARY:
                                    await frontend.send_bytes(message.data)
                                elif message.type == WSMsgType.TEXT:
                                    await frontend.send_str(message.data)
                                else:
                                    break
                        tasks = [asyncio.create_task(forward_front()), asyncio.create_task(forward_back())]
                        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                        for task in tasks:
                            task.cancel()
                        await asyncio.gather(*tasks, return_exceptions=True)
                        for task in done:
                            if not task.cancelled() and task.exception() is not None:
                                raise task.exception()
            except Exception:
                pass
            await frontend.close()
            return frontend

        if request.method != "GET":
            return web.Response(status=405, text="Metodo nao permitido")
        async with ClientSession(timeout=ClientTimeout(total=30), auto_decompress=False) as session:
            async with session.get(BACKEND + str(request.rel_url), allow_redirects=False) as upstream:
                payload = await upstream.read()
                response = web.Response(body=payload, status=upstream.status)
                for key in ("Content-Type", "Content-Encoding", "Cache-Control"):
                    if upstream.headers.get(key):
                        response.headers[key] = upstream.headers[key]
                return response

    app.router.add_route("*", "/{tail:.*}", handler)
    return app

def process(*args, env=None):
    return subprocess.Popen(
        list(args), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True)

async def start():
    from oidc_listener import register_runner, publish_takeover
    await register_runner()
    secret = secrets.token_urlsafe(40)
    # Do not pass GitHub API credentials to any browser/desktop subprocess.
    privileged = {"GH_TOKEN", "GITHUB_TOKEN", "ACTIONS_RUNTIME_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"}
    env = {k: v for k, v in os.environ.items() if k not in privileged}
    env["DISPLAY"] = DISPLAY
    processes = []
    browser_profile = Path("/tmp/bushin-private-discord-profile")
    browser_profile.mkdir(mode=0o700, parents=True, exist_ok=True)
    controller_task = None

    try:
        if not Path(VNC_DIR, "vnc.html").is_file():
            raise RuntimeError("Arquivos noVNC nao encontrados")
        processes.append(process("Xvfb", DISPLAY, "-screen", "0", "1365x768x24", "-nolisten", "tcp", env=env))
        await asyncio.sleep(2)
        processes.append(process("openbox", env=env))
        processes.append(process(
            "x11vnc", "-display", DISPLAY, "-localhost", "-forever",
            "-shared", "-nopw", "-rfbport", "5900", "-quiet", env=env))
        processes.append(process(
            "websockify", "--web", VNC_DIR, "127.0.0.1:6081", "127.0.0.1:5900", env=env))

        # Chromium binary installed by the Playwright setup step.
        from playwright.async_api import async_playwright
        pw = await async_playwright().start()
        chromium_bin = pw.chromium.executable_path
        await pw.stop()
        chromium_args = (
            chromium_bin, "--no-sandbox", "--disable-dev-shm-usage",
            "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9222",
            "--no-first-run", "--disable-default-apps", "--disable-features=MediaRouter",
            "--user-data-dir=" + str(browser_profile), "--window-size=1300,720",
            LOGIN_URL)
        chromium_position = len(processes)
        processes.append(process(*chromium_args, env=env))
        await asyncio.sleep(4)
        if any(p.poll() is not None for p in processes):
            raise RuntimeError("Um processo do desktop terminou antes de iniciar")

        gateway = web.AppRunner(make_app(secret), access_log=None)
        await gateway.setup()
        site = web.TCPSite(gateway, "127.0.0.1", PORT)
        await site.start()
        tunnel_bin = os.environ.get("CLOUDFLARED_BIN", "/tmp/cloudflared")
        tunnel = subprocess.Popen(
            [tunnel_bin, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:" + str(PORT)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            bufsize=1, start_new_session=True, env=env)
        processes.append(tunnel)

        loop = asyncio.get_running_loop()
        url_queue = asyncio.Queue()
        def read_tunnel():
            for line in tunnel.stdout:
                found = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
                if found:
                    loop.call_soon_threadsafe(url_queue.put_nowait, found.group(0))
        import threading
        threading.Thread(target=read_tunnel, daemon=True).start()

        print("🍥 Bushin Linux iniciou; aguardando endereco HTTPS privado...", flush=True)
        try:
            base_url = await asyncio.wait_for(url_queue.get(), timeout=100)
        except asyncio.TimeoutError:
            raise RuntimeError("Cloudflare nao retornou endereco HTTPS em 100 segundos")

        # Set the single allowed Origin before accepting form submissions.
        gateway.app["public_origin"]["url"] = base_url.rstrip("/")
        # Public hostname only: never publish the private /connect key.
        Path("/tmp/bushin-public-origin").write_text(base_url.rstrip("/") + "/vnc.html?autoconnect=1&resize=scale", encoding="utf-8")
        private_url = base_url.rstrip("/") + "/connect?key=" + quote(secret)
        # The takeover link is encrypted at rest and revealed only after owner's OAuth.
        await publish_takeover(private_url)
        panel_url = "https://bushin-discord-direct.henrique-silva081106.workers.dev/mobile/visual"
        summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
        summary = (
            "## 🍥 Bushin — navegador Linux protegido\n\n"
            "[Abrir painel privado Bushin (login OAuth)](" + panel_url + ")\n\n"
            "Dentro do painel, toque em **Assumir navegador visual**.\n\n"
            "Nenhum token de Discord, cookie ou link secreto aparece nos logs.\n"
            "Sessão temporária, encerrada no fim da execução Actions.\n"
        )
        if summary_path:
            Path(summary_path).open("a", encoding="utf-8").write(summary)
        print("🍥 Painel privado:", panel_url, flush=True)
        print("🍥 Faça login manualmente no Discord pelo navegador protegido.", flush=True)

        # OIDC-validated Cloudflare D1 command queue; no GitHub PAT on runner.
        from oidc_listener import listen_commands
        controller_task = asyncio.create_task(listen_commands())
        started = time.monotonic()
        browser_disconnects = 0
        browser_restarts = 0
        while time.monotonic() - started < MAX_SECONDS:
            await asyncio.sleep(30)
            if controller_task.done():
                raise RuntimeError("The browser command receiver stopped")
            if tunnel.poll() is not None:
                raise RuntimeError("Tunel seguro foi encerrado")
            if any(p.poll() is not None for p in processes[:4]):
                raise RuntimeError("Desktop ou servidor VNC parou")
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection("127.0.0.1", 9222), timeout=4)
                writer.close()
                await writer.wait_closed()
                browser_disconnects = 0
            except (OSError, asyncio.TimeoutError):
                browser_disconnects += 1
                if browser_disconnects >= 2:
                    if browser_restarts >= 5:
                        raise RuntimeError("Chromium disconnected too many times")
                    print("🍥 Bushin: Chromium CDP disconnected; restarting with the same temporary browser profile", flush=True)
                    old_browser = processes[chromium_position]
                    if old_browser.poll() is None:
                        old_browser.terminate()
                        try:
                            await asyncio.wait_for(asyncio.to_thread(old_browser.wait), timeout=5)
                        except asyncio.TimeoutError:
                            old_browser.kill()
                    await asyncio.sleep(3)
                    processes[chromium_position] = process(*chromium_args, env=env)
                    browser_restarts += 1
                    browser_disconnects = 0
            minutes = int((time.monotonic() - started) / 60)
            if minutes % 5 == 0:
                print("🍥 Linux online - %s min decorridos" % minutes, flush=True)
        print("Limite da sessao encerrado. Fechando navegador.", flush=True)
    finally:
        if controller_task is not None:
            controller_task.cancel()
            await asyncio.gather(controller_task, return_exceptions=True)
        for p in reversed(processes):
            if p.poll() is None:
                try:
                    p.terminate()
                except OSError:
                    pass

if __name__ == "__main__":
    try:
        asyncio.run(start())
    except Exception as exc:
        print("Bushin live falhou: " + str(exc)[:300], file=sys.stderr, flush=True)
        sys.exit(1)
