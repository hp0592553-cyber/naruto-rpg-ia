import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS as source} from '../discord2-ui.mjs';
const start=source.indexOf('function validateCommandOptions('),end=source.indexOf('async function sendSelectedSlash(',start);
const c=vm.createContext();vm.runInContext(source.slice(start,end)+';this.validate=validateCommandOptions',c);
const def=(type,extra={})=>({options:[{name:'value',type,...extra}]});
test('IDs preserve precision and mentions are accepted',()=>{
 for(const type of [6,7,8,9])assert.equal(c.validate(def(type),{value:'<@481485837801095178>'}).value,'481485837801095178');
 assert.throws(()=>c.validate(def(6),{value:'abc'}));
 assert.throws(()=>c.validate(def(6),{value:481485837801095178}));
});
test('typed JSON gets the same validation as form options',()=>{
 for(const [type,value] of [[5,'false'],[4,true],[4,1.5],[10,NaN],[3,2],[11,'file']])assert.throws(()=>c.validate(def(type),{value}));
 assert.equal(c.validate(def(5),{value:false}).value,false);
 assert.throws(()=>c.validate(def(4,{min_value:1,max_value:3}),{value:4}));
 assert.throws(()=>c.validate(def(3,{required:true}),{}));
 assert.throws(()=>c.validate(def(3),{other:'x'}));
 assert.throws(()=>c.validate(def(3,{choices:[{value:'ok'}]}),{value:'bad'}));
});
