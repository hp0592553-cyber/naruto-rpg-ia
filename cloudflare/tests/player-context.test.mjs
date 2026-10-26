import test from 'node:test';
import assert from 'node:assert/strict';
import {chatContext,replyTarget,replyText} from '../player-context.mjs';
const owner='481485837801095178',author='123456789012345678',mid='234567890123456789',now=Date.now();
const message={id:mid,author_id:author,timestamp:new Date(now).toISOString(),content:'Henrique, chegou na Floresta?',mentions:[{id:owner}]};
test('reply targets only a fresh human mention of the owner once',()=>{
 assert.equal(replyTarget([message],owner,now-1000,[],now)?.id,mid);
 for(const m of [{...message,mentions:[]},{...message,author_bot:true},{...message,mention_everyone:true},{...message,author_id:owner},{...message,timestamp:new Date(now-20000).toISOString()}])assert.equal(replyTarget([m],owner,now-1000,[],now),null);
 assert.equal(replyTarget([message],owner,now-1000,[mid],now),null);
});
test('a direct reply to the owner is verified by referenced author ID',()=>{
 assert.equal(replyTarget([{...message,mentions:[],referenced_message:{author_id:owner}}],owner,now-1000,[],now)?.id,mid);
 assert.equal(replyTarget([{...message,mentions:[],referenced_message:{author_id:author}}],owner,now-1000,[],now),null);
});
test('chat output mentions only the verified author and blocks model supplied mentions and URLs',()=>{
 assert.equal(replyText('Já cheguei na Floresta.',message),'<@'+author+'> Já cheguei na Floresta.');
 for(const text of ['@everyone oi','<@999999999999999999> oi','https://example.test','/viajar','duas\nlinhas'])assert.throws(()=>replyText(text,message));
});
test('context is bounded and preserves real mention/reply IDs',()=>{
 const result=chatContext([{...message,normalized_text:'a'.repeat(2000),message_reference:{message_id:mid}}]);
 assert.equal(result[0].text.length,1600);assert.deepEqual(result[0].mentions,[owner]);assert.equal(result[0].reply_to,mid);
});
