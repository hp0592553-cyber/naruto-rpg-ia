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
    async def test_uses_completed_text_even_if_cli_never_exits(self):
        calls=[]
        process=SimpleNamespace(returncode=None)
        def terminate():process.returncode=-15
        async def wait():return process.returncode
        process.terminate=terminate;process.kill=terminate;process.wait=wait
        async def spawn(*args,**kwargs):
            calls.append((args,kwargs))
            event={'type':'text','part':{'text':json.dumps({'command':'/mapa','options':{},'channel_id':'123456789012345678'})}}
            kwargs['stdout'].write((json.dumps(event)+'\n').encode());kwargs['stdout'].flush()
            return process
        with patch.dict('os.environ',{'RPG_MODEL':'test/model','DISCORD_USER_TOKEN':'must-not-reach-planner'}),patch('opencode_planner.asyncio.create_subprocess_exec',side_effect=spawn):
            result=await plan('{"commands":["/mapa"]}')
        self.assertEqual(result['plan']['command'],'/mapa')
        self.assertEqual(process.returncode,-15)
        self.assertNotIn('--file',calls[0][0])
        self.assertNotIn('DISCORD_USER_TOKEN',calls[0][1]['env'])
