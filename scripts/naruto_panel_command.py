"""One user-selected slash command, through the existing Discord client."""
import asyncio
import json
import os
import re


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
    # Do not print response bodies or raw exceptions into public workflow logs.
    public = {k: result.get(k) for k in ('status', 'command_attempted', 'command_sent', 'command_completed', 'interaction_id', 'http_status', 'error_type', 'missing')}
    print(json.dumps(public, ensure_ascii=False))
    return 0 if result.get('command_completed') is True else 1


if __name__ == '__main__':
    try:
        request = validate_request(os.environ['RPG_COMMAND_JSON'])
    except (ValueError, KeyError, TypeError):
        raise SystemExit('Invalid command request; nothing sent')
    raise SystemExit(asyncio.run(run(request)))
