import test from 'node:test';
import assert from 'node:assert/strict';
import {PANEL_JS,PANEL_HTML} from '../discord2-ui.mjs';
import {AUTOPLAY_JS} from '../autoplay-ui.mjs';
import {readFileSync} from 'node:fs';

test('the Android chat polls newly started collection faster than ordinary messages',()=>{
 assert.match(PANEL_JS,/function timedCollectionIsFresh\(\)/);
 assert.match(PANEL_JS,/interval=timedCollectionIsFresh\(\)\?2500:10000/);
 assert.match(PANEL_JS,/Date\.now\(\)<discordPauseUntil/);
 assert.match(PANEL_JS,/liveReadFailures/);
 assert.doesNotMatch(PANEL_JS,/refresh\(true\)\},30000/);
});

test('unchanged message pages do not redraw hundreds of Discord cards',()=>{
 assert.match(PANEL_JS,/if\(newOnes\.length\|\|changed\)render\(/);
 assert.match(PANEL_JS,/old\.edited_timestamp!==m\.edited_timestamp/);
});

test('timed private collection correctly describes missing verified buttons',()=>{
 assert.match(PANEL_HTML,/autoplayCollectNotice/);
 assert.match(AUTOPLAY_JS,/function updateCollectionStatus\(/);
 assert.match(AUTOPLAY_JS,/age>=0&&age<5/);
 assert.match(AUTOPLAY_JS,/age>=5&&age<13/);
 assert.match(AUTOPLAY_JS,/não contém botões confirmados/);
 assert.match(AUTOPLAY_JS,/setInterval\(updateCollectionStatus,1000\)/);
});

test('temporarily failed status polling can recover while rate limits retain longer pauses',()=>{
 assert.match(AUTOPLAY_JS,/autoplayTransientRetryAt/);
 assert.match(AUTOPLAY_JS,/e\.rateLimited\?Math\.max\(30000/);
 const server=readFileSync(new URL('../player-loop.mjs',import.meta.url),'utf8');
 assert.match(server,/429\|rate\.limit\|Too Many Requests/);
 assert.match(server,/\?60000:12000/);
 assert.match(server,/Nada reenviado/);
});
