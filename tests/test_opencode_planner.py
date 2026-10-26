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
