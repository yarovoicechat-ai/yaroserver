const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const load = (relative, dependencies) => {
  const filename = path.resolve(__dirname, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, __dirname: path.dirname(filename),
    console, process: { env: {}, cwd: () => __dirname }, Buffer,
    require: name => {
      if (name in dependencies) return dependencies[name];
      if (['path', 'fs', 'crypto'].includes(name)) return require(name);
      throw new Error('Unexpected dependency: ' + name);
    },
  }, { filename });
  return module.exports;
};

test('room opening records follower activity and delivers room navigation data', async () => {
  const activity = [], pushes = [];
  let filter;
  const follower = { _id: 'follower', fcmToken: 'device' };
  const service = load('../services/roomOpenNotification.service.ts', {
    '../models/user.model': { User: {
      findById: () => ({ select: () => ({ lean: async () => ({ name: 'Host', blockedUsers: ['blocked'] }) }) }),
      find: query => { filter = query; return { select: () => ({ lean: () => ({ cursor: () => (async function* () { yield follower; })() }) }) }; },
    } },
    '../controllers/notificationController': { createNotification: async (...args) => activity.push(args) },
    '../utils/pushNotification': { sendPushNotification: async (...args) => pushes.push(args) },
  });
  await service.notifyRoomFollowers({ ownerId: 'owner', channelName: 'room-1', title: 'Music' });
  assert.equal(filter.following, 'owner');
  assert.equal(filter.blockedUsers.$ne, 'owner');
  assert.equal(filter._id.$nin[0], 'blocked');
  assert.equal(activity[0][0], 'follower');
  assert.equal(activity[0][3], 'event');
  assert.equal(pushes[0][1].data.roomId, 'room-1');
  assert.equal(pushes[0][1].data.action, 'open_room');
});

test('call and room tokens use bounded duration even with enormous balances', async () => {
 const calls=[];
 const {AgoraTokenService}=load('../services/agora/agoraToken.service.ts', {
 'agora-token': {RtcRole:{PUBLISHER:1}, RtcTokenBuilder:{buildTokenWithUid:(...args)=>{calls.push(args);return require('agora-token').RtcTokenBuilder.buildTokenWithUid(...args);}}},
 mongoose:{Types:{}}, '../../models/agoraProject.model':{}, '../../models/agoraConfig.model':{}, './agoraSecurity':{}, './agoraProject.service':{}
 });
 AgoraTokenService.resolveProject=async()=>({project:{appId:'a'.repeat(32),_id:'project'},certificate:'b'.repeat(32),configVersion:1});
 for(const minutes of [10,2e238,Infinity,NaN]) {
 const result=await AgoraTokenService.generateCallTokens('test',123,456,minutes);
 assert.ok(result.callerToken.length>20);assert.ok(result.hostToken.length>20);
 }
 await AgoraTokenService.generateRoomToken('room',123);
 for(const args of calls) {assert.equal(args[5],86400);assert.equal(args[6],86400);}
});
