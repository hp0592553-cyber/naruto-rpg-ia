"""Transport tests with no Discord connection or credentials."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import command_service as service


class CommandServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_authorization_never_calls_game_action(self):
        sends = []
        executor = SimpleNamespace(state={},status=AsyncMock(return_value={'status':'connected'}))

        async def consult(command, options):
            if not await executor.before_send():
                return {'command_completed':False,'status':'stopped_before_send'}
            sends.append(command)
            return {'command_completed':True,'response':{'message_id':'real-response'}}

        executor.consult = consult
        job = {'request_id':'12345678-1234-1234-1234-123456789abc',
               'command':'/perfil ver','channel_id':'1520114348079583263','options':{}}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ), \
             patch.object(service, 'request', return_value={'authorized':False}) as request, \
             patch.object(service, 'deliver', new_callable=AsyncMock):
            await service.execute_job(executor, job, Path(directory))
            self.assertEqual(sends, [])
            request.assert_called_once_with('authorize', {'request_id':job['request_id']})
            self.assertEqual(json.loads((Path(directory)/'pending-result.json').read_text()),
                             {'request_id':job['request_id']})
            self.assertIsNone(executor.before_send)

    async def test_presence_continues_while_a_game_response_is_pending(self):
        pulse = asyncio.Event()
        loop = asyncio.get_running_loop()
        executor = SimpleNamespace(client=SimpleNamespace(is_ready=lambda:True,
                                   user=SimpleNamespace(id=481485837801095178)))

        def request(route, data):
            self.assertEqual(route, 'heartbeat')
            self.assertEqual(data['version'], 4)
            self.assertEqual(data['instance_id'], service.INSTANCE_ID)
            loop.call_soon_threadsafe(pulse.set)
            return {'saved':True}

        with patch.object(service, 'request', side_effect=request):
            task = asyncio.create_task(service.heartbeat(executor, loop.time()+60))
            try:
                await asyncio.wait_for(pulse.wait(), 2)
                self.assertFalse(task.done())
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)


if __name__ == '__main__':
    unittest.main()
