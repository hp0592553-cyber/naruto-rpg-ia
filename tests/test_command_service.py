import asyncio
import ast
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
    def test_components_v2_traversal_rejects_disabled_and_link_controls(self):
        source=ast.parse((Path(__file__).resolve().parents[1]/'scripts/naruto_guarded_mcp.py').read_text())
        nodes=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='find_game_component']
        env={};exec(compile(ast.Module(body=nodes,type_ignores=[]),'<components>','exec'),env)
        active={'type':3,'custom_id':'destination','options':[{'label':'Floresta','value':'forest'}]}
        nodes=[{'type':17,'components':[{'type':1,'components':[active,{'type':2,'custom_id':'disabled','disabled':True},{'type':2,'custom_id':'link','url':'https://example.test'}]}]}]
        find=env['find_game_component']
        self.assertIs(find(nodes,'destination'),active)
        self.assertIsNone(find(nodes,'disabled'));self.assertIsNone(find(nodes,'link'));self.assertIsNone(find(nodes,'unknown'))

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
