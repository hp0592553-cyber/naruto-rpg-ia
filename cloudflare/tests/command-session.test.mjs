import test from 'node:test';
import assert from 'node:assert/strict';
import {validSessionClaims} from '../command-session.mjs';
test('GitHub enrollment rejects wrong repository, workflow, branch, audience and expired credentials',()=>{
 const repo='hp0592553-cyber/naruto-rpg-ia',aud='https://example.test/bridge/commands/enroll',now=10000;
 const c={iss:'https://token.actions.githubusercontent.com',aud,repository:repo,repository_id:'1429981222',repository_owner_id:'259182200',ref:'refs/heads/Projeto',event_name:'workflow_dispatch',workflow_ref:repo+'/.github/workflows/bushin-cloudflare-ci.yml@refs/heads/Projeto',runner_environment:'github-hosted',run_id:'40342474244',exp:now+300,iat:now};
 assert.equal(validSessionClaims(c,aud,now),true);
 assert.equal(validSessionClaims({...c,workflow_ref:repo+'/.github/workflows/opencode-projeto.yml@refs/heads/Projeto'},aud,now),false,'legacy YAML rejected');
 for(const [key,value] of [['repository','other/repo'],['ref','refs/heads/main'],['workflow_ref','other'],['aud','other'],['event_name','pull_request'],['exp',now-1],['iat',now-700],['runner_environment','self-hosted']])assert.equal(validSessionClaims({...c,[key]:value},aud,now),false,key);
});
