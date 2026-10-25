"""One user-selected slash command, through the existing Discord client."""
import asyncio
import json
import os
import re
import urllib.request
import urllib.parse
import urllib.error


def publish_response(response):
    endpoint = 'https://bushin-discord-direct.henrique-silva081106.workers.dev/internal/discord2-result'
    oidc_url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'] + '&audience=' + urllib.parse.quote(endpoint, safe='')
    request = urllib.request.Request(oidc_url, headers={'Authorization':'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urllib.request.urlopen(request, timeout=15) as handle:
        oidc = json.load(handle)['value']
    payload = json.dumps({'request_id':os.environ['RPG_REQUEST_ID'],'response':response}).encode()
    request = urllib.request.Request(endpoint, data=payload, headers={'Authorization':'Bearer ' + oidc,'Content-Type':'application/json','User-Agent':'Bushin-Discord2-Relay/1.0'}, method='POST')
    with urllib.request.urlopen(request, timeout=20) as handle:
        return json.load(handle).get('saved') is True


def validate_request(raw):
    data = json.loads(raw)
    if not isinstance(data, dict) or set(data) != {'command', 'channel_id', 'options'}:
        raise ValueError('Invalid request')
    command = data['command']
    if not isinstance(command, str) or not re.fullmatch(r'/?[\w-]+(?: [\w-]+){0,2}', command) or len(command) > 100:
        raise ValueError('Invalid command')
    if not isinstance(data['channel_id'], str) or not re.fullmatch(r'[0-9]{15,22}', data['channel_id']):
        raise ValueError('Invalid channel')
    options = data['options']
    if not isinstance(options, dict) or len(options) > 25:
        raise ValueError('Invalid options')
    for key, value in options.items():
        if not re.fullmatch(r'[\w-]{1,32}', key) or type(value) not in (str, int, float, bool):
            raise ValueError('Invalid option')
        if isinstance(value, str) and len(value) > 2000:
            raise ValueError('Option too long')
    return data


async def run(data):
    import naruto_guarded_mcp as executor
    executor.CHANNEL_ID = int(data['channel_id'])
    result = {'command_completed': False, 'status': 'not_started'}
    try:
        connected = await executor.status()
        if connected.get('status') != 'connected':
            result = connected
        else:
            result = await executor.consult(data['command'], data['options'])
    except Exception as exc:
        result = {**executor.state, 'status': 'failed_or_uncertain', **executor.safe_error(exc)}
    finally:
        await executor.client.close()
        if executor.connection:
            executor.connection.cancel()
            await asyncio.gather(executor.connection, return_exceptions=True)
    if result.get("command_completed") and result.get("response"):
        try:
            result["response_relayed"] = await asyncio.to_thread(publish_response, result["response"])
        except urllib.error.HTTPError as exc:
            result["response_relayed"] = False
            result["relay_http_status"] = exc.code
            try:
                stage = json.load(exc).get("stage")
                if stage in {"method","identity","signing_keys","signature","payload","request_correlation","workflow_correlation","response_validation","encrypted_storage","run_access"}:
                    result["relay_stage"] = stage
            except Exception:
                pass
        except Exception as exc:
            result["response_relayed"] = False
            result["relay_error_type"] = type(exc).__name__
    # Do not print response bodies or raw exceptions into public workflow logs.
    public = {k: result.get(k) for k in ('status', 'command_attempted', 'command_sent', 'command_completed', 'interaction_id', 'http_status', 'error_type', 'missing', 'response_relayed', 'relay_http_status', 'relay_stage', 'relay_error_type')}
    print(json.dumps(public, ensure_ascii=False))
    return 0 if result.get('command_completed') is True else 1


if __name__ == '__main__':
    try:
        request = validate_request(os.environ['RPG_COMMAND_JSON'])
    except (ValueError, KeyError, TypeError):
        raise SystemExit('Invalid command request; nothing sent')
    raise SystemExit(asyncio.run(run(request)))
