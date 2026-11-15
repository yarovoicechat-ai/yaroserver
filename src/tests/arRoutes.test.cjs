const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),express=require('express');
const stored=new Map();
const model={
  find:()=>({select:()=>({lean:async()=>[...stored.values()]})}),
  exists:async({id})=>stored.has(id),
  create:async value=>{stored.set(value.id,value);return value},
  findOneAndUpdate:async({id},update)=>{const value={...stored.get(id),...update.$set};stored.set(id,value);return value},
};
const original=Module._load;
Module._load=function(name,parent,isMain){
  if(name.endsWith('/arEffect.model'))return {__esModule:true,default:model};
  if(name.endsWith('/middlewares/authorize.middleware'))return {
    verifyToken:(req,res,next)=>{if(!req.headers['x-user'])return res.status(401).json({success:false});req.user={id:req.headers['x-user'],role:req.headers['x-role']||'user'};next()},
    requireRoles:(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({success:false}),
  };
  return original.call(this,name,parent,isMain);
};
const {arRouter,arAdminRouter}=require('../ar/arRoutes');Module._load=original;
let server,base;
test.before(async()=>{const app=express();app.use(express.json());app.use('/api/ar',arRouter);app.use('/api/admin/ar',arAdminRouter);app.use((e,req,res,next)=>res.status(500).json({message:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port});
test.after(()=>new Promise(resolve=>server.close(resolve)));
const request=(path,method='GET',role='',body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(role?{'x-user':'507f1f77bcf86cd799439011','x-role':role}:{})},...(body?{body:JSON.stringify(body)}:{})});
const effect={id:'original-test',name:'Original Test',category:'Special',version:'1.0.0',platforms:['android','ios'],active:false,premium:false,status:'pending',thumbnailUrl:null,assetUrl:null,assetHash:null};
test('offline catalog and categories are readable without creating an account',async()=>{
  const list=await(await request('/api/ar/effects')).json();assert.equal(list.data.length,50);
  assert.equal((await request('/api/ar/categories')).status,200);
  assert.equal((await request('/api/ar/effects/puppy')).status,200);
});
test('every admin mutation uses the existing authenticated manager boundary',async()=>{
  for(const [path,method] of [['/api/admin/ar/effects','POST'],['/api/admin/ar/effects/puppy','PUT'],['/api/admin/ar/effects/puppy','DELETE'],['/api/admin/ar/effects/puppy/status','PATCH']]){
    assert.equal((await request(path,method,'',effect)).status,401);
    assert.equal((await request(path,method,'user',effect)).status,403);
  }
});
test('metadata can be created, updated, activated and softly deleted',async()=>{
  assert.equal((await request('/api/admin/ar/effects','POST','admin',effect)).status,201);
  assert.equal((await request('/api/admin/ar/effects','POST','admin',effect)).status,409);
  assert.equal((await request('/api/ar/effects/original-test')).status,404);
  assert.equal((await request('/api/admin/ar/effects/original-test','PUT','admin',{...effect,name:'Updated Original'})).status,200);
  assert.equal((await request('/api/admin/ar/effects/original-test/status','PATCH','admin',{active:true})).status,200);
  assert.equal((await(await request('/api/ar/effects/original-test')).json()).data.name,'Updated Original');
  assert.equal((await request('/api/admin/ar/effects/original-test','DELETE','admin')).status,200);
  assert.equal(stored.get(effect.id).deleted,true);assert.equal((await request('/api/ar/effects/original-test')).status,404);
});
test('bundled IDs cannot be duplicated and invalid asset claims are rejected',async()=>{
  assert.equal((await request('/api/admin/ar/effects','POST','admin',{...effect,id:'puppy'})).status,409);
  assert.equal((await request('/api/admin/ar/effects','POST','admin',{...effect,id:'invalid-verified',status:'verified'})).status,400);
  assert.equal((await request('/api/admin/ar/effects/puppy/status','PATCH','admin',{active:'true'})).status,400);
});
