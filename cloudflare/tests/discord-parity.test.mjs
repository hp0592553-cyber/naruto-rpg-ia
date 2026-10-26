import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PANEL_JS} from '../discord2-ui.mjs';
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this.textContent=''}
 append(...nodes){this.children.push(...nodes)}
 setAttribute(k,v){this.attrs[k]=v}
 removeAttribute(k){delete this[k];delete this.attrs[k]}
 get childNodes(){return this.children}
 get childElementCount(){return this.children.length}
}
const text=e=>e.textContent+e.children.map(text).join('');
function fixture(){
 const c=vm.createContext({Intl,URL,Date,document:{createElement:t=>new Element(t),createTextNode:t=>Object.assign(new Element('#text'),{textContent:t})},gameUrl:()=> 'https://discord.com/channels/1/2/3',knownPeople:new Map(),safeDisplay:s=>s,S:{channels:[]}});
 const chunks=[['function discordTimestamp(','function trusted('],['function renderMentionText(','function findMentionPeople('],['function gameControls(','const knownPeople='],['function messageExtras(','function render(mode=']];
 for(const [a,b] of chunks)vm.runInContext(PANEL_JS.slice(PANEL_JS.indexOf(a),PANEL_JS.indexOf(b,PANEL_JS.indexOf(a))),c);
 const a=PANEL_JS.indexOf('const author='),b=PANEL_JS.indexOf('function searchKey(',a);vm.runInContext(PANEL_JS.slice(a,b)+';this.authorName=author',c);
 return c;
}
test('author prefers guild nick then global name then username',()=>{
 const c=fixture();assert.equal(c.authorName({author_nickname:'Klein Uchiha',author_global_name:'Global',author_name:'user'}),'Klein Uchiha');
 assert.equal(c.authorName({author_global_name:'Nome exibido',author_name:'user'}),'Nome exibido');
 assert.equal(c.authorName({author_name:'user'}),'user');
});
test('all Discord timestamp formats render without raw syntax, invalid range stays harmless',()=>{
 const c=fixture();for(const format of 'tTdDfFR'){assert.equal(typeof c.discordTimestamp('1793286000',format),'string');}
 assert.equal(c.discordTimestamp('999999999999999'),null);
 const host=new Element();c.renderMentionText(host,{mentions:[]},'Volte <t:1793286000:f> ou <t:1793286000:R>.');
 assert.doesNotMatch(text(host),/<t:/);assert.match(text(host),/2026/);
 assert.equal(host.children.filter(e=>e.className==='discordTimestamp').length,2);
});
test('buttons from other bots are visible without sending an interaction',()=>{
 const c=fixture(),host=new Element();c.gameControls(host,{author_id:'123456789012345678',components:[{type:1,components:[{type:2,label:'Quick Sell',custom_id:'sell',style:1}]}]});
 assert.match(text(host),/Quick Sell/);const group=host.children.find(e=>e.className==='gameActions');assert.equal(group.children[0].href,'https://discord.com/channels/1/2/3');
});
test('link buttons preserve HTTPS destination and disabled/unsafe links are inert',()=>{
 const c=fixture();assert.equal(c.componentLink({style:5,url:'https://example.com/game'},{}),'https://example.com/game');
 for(const url of ['javascript:alert(1)','http://example.com','https://user:secret@example.com'])assert.equal(c.componentLink({style:5,url},{}),null);
 const host=new Element();c.gameControls(host,{components:[{type:2,label:'Desativado',disabled:true},{type:2,label:'Inseguro',style:5,url:'javascript:alert(1)'}]});
 const group=host.children.find(e=>e.className==='gameActions');for(const a of group.children){assert.equal(a.href,undefined);assert.equal(a.attrs['aria-disabled'],'true');}
});
test('select option labels, polls and stickers retain visible information without voting',()=>{
 const c=fixture(),host=new Element();c.gameControls(host,{components:[{type:3,placeholder:'Escolha',options:[{label:'Defender',value:'defend'}]}]});assert.match(text(host),/Defender/);
 c.messageExtras(host,{poll:{question:'Qual rota?',answers:[{text:'Floresta'},{text:'Vila'}]},stickers:[{id:'123456789012345678',name:'Figurinha',format_type:1}]});
 assert.match(text(host),/Qual rota\?FlorestaVila/);assert.match(text(host),/votar no Discord/);
 const sticker=host.children.find(e=>e.className==='discordSticker');assert.equal(sticker.children[0].src,'https://cdn.discordapp.com/stickers/123456789012345678.png');
});
