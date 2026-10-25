import ast
import math
import re
import unittest
from pathlib import Path
from types import SimpleNamespace as NS

source = ast.parse((Path(__file__).resolve().parents[1]/'scripts/naruto_guarded_mcp.py').read_text())
nodes = [n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == 'prepare_options']
env = {'math':math,'re':re,'discord':NS(Object=lambda **kw:NS(**kw))}
exec(compile(ast.Module(body=nodes,type_ignores=[]), '<options>', 'exec'),env)
prepare = env['prepare_options']

class Options(unittest.TestCase):
    def option(self, kind, **kwargs):
        return NS(options=[NS(name='value',type=NS(value=kind),**kwargs)])
    def test_ids_become_snowflake_objects(self):
        for kind in (6,7,8,9):
            for value in ('481485837801095178','<@481485837801095178>','<@!481485837801095178>','<@&481485837801095178>','<#481485837801095178>'):
                self.assertEqual(prepare(self.option(kind),{'value':value})['value'].id,481485837801095178)
    def test_invalid_values_never_reach_sender(self):
        cases=[(6,'abc'),(6,481485837801095178),(5,'false'),(4,True),(4,1.5),(10,float('nan')),(10,float('inf')),(3,False),(11,'file.png')]
        for kind,value in cases:
            with self.subTest(kind=kind,value=value),self.assertRaises(ValueError):
                prepare(self.option(kind),{'value':value})
    def test_choices_bounds_and_required(self):
        self.assertEqual(prepare(self.option(5),{'value':False}),{'value':False})
        self.assertEqual(prepare(self.option(4,min_value=1,max_value=3),{'value':2}),{'value':2})
        for command,values in [(self.option(4,min_value=1),{'value':0}),(self.option(3,choices=[NS(value='ok')]),{'value':'other'}),(self.option(3,required=True),{}),(self.option(3),{'unknown':'x'})]:
            with self.assertRaises(ValueError):prepare(command,values)

if __name__ == '__main__': unittest.main()
