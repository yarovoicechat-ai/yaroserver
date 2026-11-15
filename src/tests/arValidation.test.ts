import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAREffect } from '../ar/arValidation';
import { bundledAREffects } from '../ar/bundledEffects';
const metadata = {id:'test-effect',name:'Test Effect',category:'Beauty',version:'1.0.0',platforms:['android','ios'],active:true,premium:false,status:'pending',thumbnailUrl:null,assetUrl:null,assetHash:null};
test('bundled catalog contains 50 unique definitions without false availability',()=>{
  assert.equal(bundledAREffects.length,50);assert.equal(new Set(bundledAREffects.map(effect=>effect.id)).size,50);
  assert.ok(bundledAREffects.every(effect=>effect.status==='pending' && effect.assetUrl===null));
});
test('pending metadata is explicit and validated',()=>assert.equal(validateAREffect(metadata).status,'pending'));
test('completed effects require real asset URLs and hashes',()=>assert.throws(()=>validateAREffect({...metadata,status:'verified'}),/require thumbnail/));
test('non HTTPS assets and embedded credentials are rejected',()=>{
  assert.throws(()=>validateAREffect({...metadata,assetUrl:'http://example.com/a.glb'}),/HTTPS/);
  assert.throws(()=>validateAREffect({...metadata,assetUrl:'https://secret:password@example.com/a.glb'}),/credentials/);
});
test('unknown categories, invalid IDs, string booleans and invalid hashes are rejected',()=>{
  for(const patch of [{category:'Injected'},{id:'../escape'},{active:'true'},{assetHash:'x'.repeat(64)},{platforms:['web']}]) assert.throws(()=>validateAREffect({...metadata,...patch}));
});
