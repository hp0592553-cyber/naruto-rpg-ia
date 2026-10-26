import asyncio
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, AsyncMock

spec=importlib.util.spec_from_file_location('command_service',Path(__file__).resolve().parents[1]/'scripts/command_service.py')
service=importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

class ServiceTests(unittest.TestCase):
    def test_result_is_private_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'pending-result.json'
            service.store_result(path,{'request_id':'test','response':{'content':'private'}})
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertEqual(json.loads(path.read_text())['response']['content'],'private')
            with patch.object(service,'request',return_value={'saved':True}):
                asyncio.run(service.deliver(path))
            self.assertFalse(path.exists())

    def test_delivery_retry_does_not_execute_an_action(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'pending-result.json'
            service.store_result(path,{'request_id':'test'})
            with patch.object(service,'request',side_effect=[RuntimeError('offline'),{'saved':True}]) as request,patch.object(service.asyncio,'sleep',new_callable=AsyncMock):
                asyncio.run(service.deliver(path))
            self.assertEqual(request.call_count,2)
            self.assertTrue(all(call.args[0]=='result' for call in request.call_args_list))

if __name__=='__main__':
    unittest.main()
