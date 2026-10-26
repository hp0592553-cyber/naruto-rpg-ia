#!/usr/bin/env python3
"""Persistent Discord 2 executor; credentials come only from the host environment."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = 'https://bushin-discord-direct.henrique-silva081106.workers.dev'
SESSION_TOKEN = None


def enroll_github():
    from urllib.parse import quote
    audience = BASE + '/bridge/commands/enroll'
    oidc_url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'] + '&audience=' + quote(audience, safe='')
    req = Request(oidc_url, headers={'Authorization': 'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urlopen(req, timeout=15) as handle:
        jwt = json.load(handle)['value']
    req = Request(audience, data=b'{}', method='POST', headers={'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=15) as handle:
            return json.load(handle)['token']
    except HTTPError as exc:
        stage = json.load(exc).get('stage')
        if stage in {'format', 'claims', 'keys', 'signature', 'run_access', 'run_validation'}:
            print('GitHub enrollment rejected at: ' + stage, flush=True)
        raise RuntimeError('enrollment_rejected') from None


def request(route, data):
    token = SESSION_TOKEN or os.environ['BUSHIN_EXECUTOR_TOKEN']
    req = Request(BASE + '/bridge/commands/' + route, data=json.dumps(data).encode(),
                  headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urlopen(req, timeout=15) as handle:
            return json.load(handle)
    except HTTPError as exc:
        # Never log response bodies, request headers or raw exception messages.
        raise RuntimeError('worker_http_' + str(exc.code)) from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError('worker_transport_error') from None


def store_result(path, result):
    with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        os.chmod(temporary, 0o600)
        json.dump(result, handle)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


async def deliver(path):
    """Retry result delivery only; never retry the game action."""
    data = json.loads(path.read_text())
    while True:
        try:
            result = await asyncio.to_thread(request, 'result', data)
            if result.get('saved') is True:
                path.unlink()
                return
        except RuntimeError:
            pass
        await asyncio.sleep(5)


async def execute_job(executor, job, state_dir):
    from naruto_panel_command import validate_request
    request_id = job.get('request_id', '')
    import re
    if not re.fullmatch(r'[a-f0-9-]{36}', request_id):
        raise ValueError('invalid_request_id')
    data = validate_request(json.dumps({k: job[k] for k in ('command', 'channel_id', 'options')}))
    marker = state_dir / (request_id + '.reserved')
    # An existing marker makes consult refuse a second execution after any restart.
    os.environ['RPG_ACTION_MARKER'] = str(marker)
    os.environ['RPG_MODE'] = 'jogar'
    executor.CHANNEL_ID = int(data['channel_id'])
    executor.state.update(command_attempted=False, command_sent=False, command_completed=False)
    executor.state.pop('response', None)
    executor.state.pop('interaction_id', None)
    try:
        connected = await executor.status()
        outcome = await executor.consult(data['command'], data['options']) if connected.get('status') == 'connected' else connected
    except Exception:
        outcome = {'command_completed': False}
    result = {'request_id': request_id}
    if outcome.get('command_completed') is True and outcome.get('response'):
        result['response'] = outcome['response']
    path = state_dir / 'pending-result.json'
    store_result(path, result)
    await deliver(path)


async def main():
    global SESSION_TOKEN
    import naruto_guarded_mcp as executor
    github = bool(os.environ.get('ACTIONS_ID_TOKEN_REQUEST_URL'))
    if github:
        try:
            SESSION_TOKEN = await asyncio.to_thread(enroll_github)
        except Exception:
            raise SystemExit('GitHub session authorization failed; nothing sent') from None
    if not os.environ.get('DISCORD_USER_TOKEN') or len(SESSION_TOKEN or os.environ.get('BUSHIN_EXECUTOR_TOKEN', '')) < 43:
        raise SystemExit('Service credentials missing; nothing sent')
    state_dir = Path(os.environ.get('BUSHIN_STATE_DIR', '/var/lib/bushin-command-service'))
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(state_dir, 0o700)
    pending = state_dir / 'pending-result.json'
    try:
        if pending.exists():
            await deliver(pending)
        connected = await executor.status()
        if connected.get('status') != 'connected':
            raise SystemExit('Discord connection unavailable; nothing sent')
        print('Command service connected', flush=True)
        deadline = asyncio.get_running_loop().time() + (25*60 if github else 365*24*3600)
        while executor.client.is_ready() and asyncio.get_running_loop().time() < deadline:
            try:
                result = await asyncio.to_thread(request, 'poll', {'owner_id': str(executor.client.user.id), 'ready': True})
            except RuntimeError:
                await asyncio.sleep(5)
                continue
            job = result.get('job')
            if job:
                await execute_job(executor, job, state_dir)
            else:
                await asyncio.sleep(1)
    finally:
        await executor.client.close()
        if executor.connection:
            executor.connection.cancel()
            await asyncio.gather(executor.connection, return_exceptions=True)


if __name__ == '__main__':
    asyncio.run(main())
