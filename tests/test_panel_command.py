import ast
import asyncio
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('panel', ROOT/'scripts/naruto_panel_command.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Validation(unittest.TestCase):
    def test_nested_command_and_typed_options(self):
        data = {'command':'/missoes minhas','channel_id':'1520114348079583263','options':{'quantidade':2,'ativo':True}}
        self.assertEqual(module.validate_request(json.dumps(data)),data)
    def test_invalid_requests(self):
        base = {'command':'/perfil ver','channel_id':'1520114348079583263','options':{}}
        for key,value in [('command','/perfil ver\n/outro'),('channel_id','other'),('options',{'a':{}}),('options',[]),('options',{'a':'a'*2001})]:
            with self.subTest(key=key,value=str(value)[:30]), self.assertRaises(ValueError):
                module.validate_request(json.dumps({**base,key:value}))
    def test_resolves_multiple_roots_and_groups(self):
        source = ast.parse((ROOT/'scripts/naruto_guarded_mcp.py').read_text())
        nodes = [n for n in source.body if isinstance(n,ast.AsyncFunctionDef) and n.name in ('collect','discover')]
        leaf = SimpleNamespace(name='ver',children=[])
        other = SimpleNamespace(name='minhas',children=[])
        class Slash:
            def __init__(self,name,children,app=1515908078913192026):
                self.name,self.children,self.application_id,self.guild_id=name,children,app,1515877468299595919
        roots=[Slash('perfil',[leaf]),Slash('missoes',[other]),Slash('admin',[Slash('grupo',[leaf])])]
        import inspect
        env={'inspect':inspect,'discord':SimpleNamespace(SlashCommand=Slash),'channel':SimpleNamespace(application_commands=lambda:roots),'GUILD_ID':1515877468299595919,'NARUTO_BOT_ID':1515908078913192026}
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'<discovery>','exec'),env)
        for name,target in [('perfil ver',leaf),('missoes minhas',other),('admin grupo ver',leaf),('perfil',None),('other',None),('perfil absent',None)]:
            self.assertIs(asyncio.run(env['discover'](name)),target)

if __name__ == '__main__':
    unittest.main()


class RelayExitStatus(unittest.TestCase):
    def test_missing_delivery_fails_without_resending_the_action(self):
        import contextlib
        import io
        from unittest.mock import AsyncMock, patch
        for saved, expected in [(True, 0), (False, 2)]:
            consult = AsyncMock(return_value={'command_completed':True,'response':{'content':'PRIVATE_TEST'}})
            client = SimpleNamespace(close=AsyncMock())
            executor = SimpleNamespace(status=AsyncMock(return_value={'status':'connected'}),
                consult=consult,client=client,connection=None)
            with self.subTest(saved=saved), patch.dict('sys.modules', {'naruto_guarded_mcp':executor}), patch.object(module,'publish_response',return_value=saved), contextlib.redirect_stdout(io.StringIO()) as output:
                code=asyncio.run(module.run({'channel_id':'1520114348079583263','command':'/perfil ver','options':{}}))
            self.assertEqual(code, expected)
            self.assertEqual(consult.await_count, 1)
            self.assertNotIn('PRIVATE_TEST', output.getvalue())
