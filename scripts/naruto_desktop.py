"""Inicializa desktop e Chromium visivel. Credenciais ficam fora dos artefatos."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error

TARGET = 'https://discord.com/channels/1515877468299595919/1520114348079583263'
RUNTIME = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'naruto-desktop-runtime'


def launch(name, command, env=None):
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    with (RUNTIME / (name + '.log')).open('ab') as output:
        process = subprocess.Popen(command, env=env, stdout=output, stderr=output, start_new_session=True)
    processes = json.loads((RUNTIME / 'pids.json').read_text()) if (RUNTIME / 'pids.json').exists() else {}
    processes[name] = process.pid
    (RUNTIME / 'pids.json').write_text(json.dumps(processes))
    return process


def wait_http(url + '/vnc.html', timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                return response.status
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                return 401
            time.sleep(1)
        except Exception:
            time.sleep(1)
    raise RuntimeError('Servico local nao ficou pronto: ' + url)


async def browser():
    from playwright.async_api import async_playwright
    quit_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, quit_event.set)
    profile = Path(os.environ['XDG_DATA_HOME']) / 'browser-profile'
    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(str(profile), headless=False, no_viewport=True,
            args=['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', '--start-maximized', '--password-store=basic'])
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(TARGET, wait_until='domcontentloaded', timeout=60000)
        await quit_event.wait()
        await context.close()


def start():
    if len(os.environ.get('DESKTOP_PASSWORD', '')) < 16:
        raise SystemExit('Crie o secret DESKTOP_PASSWORD com pelo menos 16 caracteres antes de iniciar a tela.')
    env = dict(os.environ, DISPLAY=':99')
    # O navegador nao precisa conhecer senhas do proxy, cache ou tokens externos.
    browser_env = {k: v for k, v in env.items() if k not in ('DESKTOP_PASSWORD', 'CHATGPT_CACHE_KEY', 'DISCORD_USER_TOKEN', 'OPENAI_API_KEY', 'OPENCODE_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN')}
    launch('xvfb', ['Xvfb', ':99', '-screen', '0', '1440x900x24', '-nolisten', 'tcp'], env)
    deadline = time.monotonic() + 30
    while not Path('/tmp/.X11-unix/X99').exists():
        if time.monotonic() > deadline:
            raise SystemExit('Xvfb nao iniciou')
        time.sleep(0.5)
    launch('xfce', ['dbus-run-session', '--', 'startxfce4'], browser_env)
    launch('vnc', ['x11vnc', '-display', ':99', '-localhost', '-rfbport', '5900', '-forever', '-shared', '-nopw', '-noxdamage'], browser_env)
    launch('websockify', ['websockify', '127.0.0.1:6081', '127.0.0.1:5900'], browser_env)
    launch('proxy', [sys.executable, str(Path(__file__).with_name('naruto_desktop_proxy.py'))], env)
    launch('browser', [sys.executable, str(Path(__file__).resolve()), 'browser'], browser_env)
    wait_http('http://127.0.0.1:9222/json/version')
    if wait_http('http://127.0.0.1:6080/vnc.html') != 401:
        raise SystemExit('Desktop nao exigiu autenticacao; tunel nao sera aberto.')
    # O CDP fica somente no loopback. O unico destino publico e o proxy autenticado.
    launch('tunnel', ['cloudflared', 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:6080'], browser_env)
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        log = (RUNTIME / 'tunnel.log').read_text(errors='replace')
        urls = re.findall(r'https://[a-z0-9]+(?:-[a-z0-9]+){2,}\.trycloudflare\.com', log)
        if urls:
            url = urls[-1]
            if wait_http(url + '/vnc.html', timeout=90) != 401:
                raise SystemExit('Tunel nao exigiu autenticacao. Acesso nao sera publicado.')
            evidence = Path(os.environ['RPG_EVIDENCE_DIR']) / 'desktop.json'
            evidence.write_text(json.dumps({'desktop_started': True, 'local_http_requires_auth': True, 'public_http_requires_auth': True, 'cdp': 'loopback_only', 'desktop_url': url}))
            print('Tela Linux protegida: ' + url)
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as out:
                out.write(f'## Tela Linux do Henrique\n[Abrir desktop]({url})\n\nUsuario: **henrique**. Senha: valor do secret **DESKTOP_PASSWORD**. Abra a tela, entre no Discord e volte a pagina inicial para clicar em **Liberar teste**. Nunca envie sua senha ou token no chat.\n')
            return
        time.sleep(1)
    raise SystemExit('O tunel nao forneceu URL. Nenhum acesso publico ao CDP foi aberto.')


def stop():
    if not (RUNTIME / 'pids.json').exists():
        return
    processes = json.loads((RUNTIME / 'pids.json').read_text())
    # Fechar primeiro o Chromium permite gravar o perfil antes de criptografar.
    pid = processes.pop('browser', None)
    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
            for _ in range(40):
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.25)
        except ProcessLookupError:
            pass
    for pid in reversed(list(processes.values())):
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def wait_ready():
    marker = Path(os.environ['RPG_DESKTOP_READY'])
    deadline = time.monotonic() + 1800
    print('Aguardando login manual no Discord e botao Liberar teste (ate 30 minutos).', flush=True)
    while time.monotonic() < deadline:
        if marker.exists():
            print('Usuario liberou o teste visual.')
            return
        time.sleep(2)
    raise SystemExit('Login manual nao liberado. Nenhuma jogada foi tentada.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('start', 'browser', 'wait', 'stop'))
    action = parser.parse_args().action
    if action == 'browser':
        asyncio.run(browser())
    else:
        {'start': start, 'wait': wait_ready, 'stop': stop}[action]()
