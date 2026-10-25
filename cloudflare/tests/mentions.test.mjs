import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
class Element {
 constructor(){this.value='';this.children=[];this.dataset={};this.handlers={};this.hidden=true}
 append(...elements){this.children.push(...elements)}
 replaceChildren(){this.children=[]}
 setAttribute(){}
 addEventListener(name,fn){this.handlers[name]=fn}
 focus(){}
 setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end}
}
const owner={id:'481485837801095178',name:'Henrique',username:'angel_10706'};
function fixture(){
 const elements={mentionBox:new Element(),message:new Element(),slashBox:new Element()};
 const leaf={options:[{name:'usuario',type:6}]};
 const c=vm.createContext({knownPeople:new Map([[owner.id,owner]]),selectedMentions:new Map(),searchKey:s=>s.toLowerCase(),E:id=>elements[id],document:{createElement:()=>new Element()},selectedCommandDefinition:path=>path==='/perfil ver'?leaf:path==='/grupo'?{options:[{type:1}]}:null,status(){},safeDisplay:s=>s});
 const start=PANEL_JS.indexOf('function findMentionPeople('),end=PANEL_JS.indexOf('function packMentionDraft(',start);
 vm.runInContext(PANEL_JS.slice(start,end)+';this.api={autocompleteMention,personOptionPicker,commandMentionTarget}',c);
 return {c,elements};
}
test('slash command @ offers a person and keeps the real Discord ID',()=>{
 const {c,elements}=fixture(),editor=elements.message;editor.value='/perfil ver @Hen';editor.selectionStart=editor.value.length;
 c.api.autocompleteMention();assert.equal(elements.mentionBox.hidden,false);assert.equal(elements.mentionBox.children.length,1);
 elements.mentionBox.children[0].onclick();
 assert.equal(editor.value,'/perfil ver {"usuario":"481485837801095178"}');assert.equal(elements.mentionBox.hidden,true);
 assert.equal(c.api.commandMentionTarget('/grupo @'),null);assert.equal(c.api.commandMentionTarget('/missing @'),null);
});
test('user option accepts names and clears stale identity when edited',()=>{
 const {c}=fixture(),input=new Element(),host=new Element();input.value='@Hen';
 c.api.personOptionPicker(input,{name:'usuario'},host);input.handlers.focus();
 const box=host.children[0];assert.equal(box.children.length,1);box.children[0].onclick();
 assert.equal(input.value,'@Henrique');assert.equal(input.dataset.personId,owner.id);assert.equal(input.dataset.personLabel,input.value);
 input.value='@someone';input.handlers.input();assert.equal(input.dataset.personId,undefined);assert.equal(input.dataset.personLabel,undefined);
});
test('ordinary message mentions remain available',()=>{
 const {c,elements}=fixture(),editor=elements.message;editor.value='oi @Hen';editor.selectionStart=editor.value.length;
 c.api.autocompleteMention();elements.mentionBox.children[0].onclick();assert.equal(editor.value,'oi @Henrique ');assert.equal(c.selectedMentions.get(owner.id),'Henrique');
});
