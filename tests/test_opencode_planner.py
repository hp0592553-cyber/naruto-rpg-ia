import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from opencode_planner import parse_decision

class PlannerTests(unittest.TestCase):
    def test_real_text_events_are_joined(self):
        decision={'command':'/mapa','options':{},'channel_id':'123456789012345678'}
        events=[{'type':'step_start'},{'type':'text','part':{'text':json.dumps(decision)}}]
        self.assertEqual(parse_decision('\n'.join(map(json.dumps,events))),decision)
    def test_provider_error_is_not_an_action(self):
        with self.assertRaises(ValueError):
            parse_decision(json.dumps({'type':'error','error':{'message':'private provider diagnostic'}}))
    def test_plain_output_and_wrong_shapes_are_not_actions(self):
        for value in ['not JSON',json.dumps({'type':'text','part':{'text':'{"command": [], "options": {}}'}})]:
            with self.assertRaises(ValueError):parse_decision(value)

from types import SimpleNamespace
from unittest.mock import patch
from opencode_planner import plan

class HeadlessPlannerTests(unittest.IsolatedAsyncioTestCase):
    async def run_planner(self, response):
        calls=[]
        process=SimpleNamespace(returncode=None)
        def terminate():process.returncode=-15
        async def wait():return process.returncode
        process.terminate=terminate;process.kill=terminate;process.wait=wait
        async def spawn(*args,**kwargs):
            calls.append((args,kwargs));return process
        requests=[]
        def request(base, auth, path, body, timeout):
            requests.append((base,auth,path,body))
            if path=='/global/health':return {'healthy':True}
            if path=='/session':return {'id':'ses_test123'}
            return response
        with patch.dict('os.environ',{'RPG_MODEL':'test/model','DISCORD_USER_TOKEN':'private-token'}),patch('opencode_planner.asyncio.create_subprocess_exec',side_effect=spawn),patch('opencode_planner.request_json',side_effect=request):
            result=await plan('{"commands":["/mapa"]}')
        self.assertEqual(process.returncode,-15)
        self.assertEqual(calls[0][0][1],'serve')
        self.assertNotIn('DISCORD_USER_TOKEN',calls[0][1]['env'])
        self.assertTrue(requests[0][0].startswith('http://127.0.0.1:'))
        self.assertTrue(requests[0][1].startswith('Basic '))
        self.assertEqual(requests[-1][3]['model'],{'providerID':'test','modelID':'model'})
        return result

    async def test_uses_headless_response_without_waiting_for_server_exit(self):
        result=await self.run_planner({'info':{},'parts':[{'type':'text','text':'{"command":"/mapa","options":{}}'}]})
        self.assertEqual(result['plan']['command'],'/mapa')

    async def test_provider_error_is_sanitized_and_not_a_game_action(self):
        result=await self.run_planner({'info':{'error':{'message':'Quota exceeded: private diagnostic'}},'parts':[]})
        self.assertEqual(result['category'],'quota')
        self.assertNotIn('private diagnostic',json.dumps(result))
        self.assertNotIn('plan',result)

    async def test_model_timeout_reports_stage_and_stops_server(self):
        from opencode_planner import request_json
        process=SimpleNamespace(returncode=None)
        def terminate():process.returncode=-15
        async def wait():return process.returncode
        process.terminate=terminate;process.wait=wait
        async def spawn(*args,**kwargs):return process
        def request(base,auth,path,body,timeout):
            if path=='/global/health':return {'healthy':True}
            if path=='/session':return {'id':'ses_test123'}
            if body is None:return []
            raise TimeoutError()
        with patch.dict('os.environ',{'RPG_MODEL':'test/model'}),patch('opencode_planner.asyncio.create_subprocess_exec',side_effect=spawn),patch('opencode_planner.request_json',side_effect=request):
            result=await plan('{}')
        self.assertEqual(result['stage'],'model')
        self.assertEqual(result['error'],'opencode_timeout')
        self.assertEqual(process.returncode,-15)

    async def test_recovers_completed_text_when_server_message_never_finishes(self):
        process=SimpleNamespace(returncode=None)
        def terminate():process.returncode=-15
        async def wait():return process.returncode
        process.terminate=terminate;process.wait=wait
        async def spawn(*args,**kwargs):return process
        def request(base,auth,path,body,timeout):
            if path=='/global/health':return {'healthy':True}
            if path=='/session':return {'id':'ses_test123'}
            if body is not None:raise TimeoutError()
            return [{'info':{'role':'user'},'parts':[]},{'info':{'role':'assistant'},'parts':[{'type':'text','text':'{"command":"/mapa","options":{}}'}]}]
        with patch.dict('os.environ',{'RPG_MODEL':'test/model'}),patch('opencode_planner.asyncio.create_subprocess_exec',side_effect=spawn),patch('opencode_planner.request_json',side_effect=request):
            result=await plan('{}')
        self.assertEqual(result['plan']['command'],'/mapa')
        self.assertEqual(process.returncode,-15)
