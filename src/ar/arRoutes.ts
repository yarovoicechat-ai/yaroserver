import { Router } from 'express';
import AREffect from './arEffect.model';
import { verifyToken,requireRoles,AuthRequest } from '../middlewares/authorize.middleware';
import { AR_CATEGORIES,validateAREffect } from './arValidation';
import { bundledAREffects } from './bundledEffects';
export const arRouter=Router(),arAdminRouter=Router();
const wrap=(handler:any)=>(req:any,res:any,next:any)=>Promise.resolve(handler(req,res)).catch(next);
async function catalog() {
  const overrides=await AREffect.find({}).select('-_id -__v -updatedBy').lean();
  const byId=new Map<string,any>(bundledAREffects.map(effect=>[effect.id,effect]));
  overrides.forEach(effect=>byId.set(effect.id,effect));
  return [...byId.values()];
}
arRouter.get('/categories',(_req,res)=>res.json({success:true,data:AR_CATEGORIES}));
arRouter.get('/effects',wrap(async(req:AuthRequest,res:any)=>{
  const platform=String(req.query.platform || '');
  const data=(await catalog()).filter(effect=>effect.active && !effect.deleted && (!platform || effect.platforms.includes(platform)));
  res.json({success:true,data});
}));
arRouter.get('/effects/:id',wrap(async(req:any,res:any)=>{
  const effect=(await catalog()).find(item=>item.id===req.params.id && item.active && !item.deleted);
  res.status(effect?200:404).json({success:!!effect,...(effect?{data:effect}:{message:'Effect not found'})});
}));
// Reuses the existing store-manager role boundary. No separate auth system.
arAdminRouter.use(verifyToken,requireRoles('owner','superAdmin','admin','operator'));
arAdminRouter.get('/effects',wrap(async(_req:any,res:any)=>res.json({success:true,data:await catalog()})));
const payload=(req:any,res:any)=> { try { return validateAREffect(req.body) } catch(error:any) { res.status(400).json({success:false,message:error.message}); return null } };
arAdminRouter.post('/effects',wrap(async(req:any,res:any)=>{
  const data=payload(req,res);if(!data)return;
  if(bundledAREffects.some(effect=>effect.id===data.id) || await AREffect.exists({id:data.id})) return res.status(409).json({success:false,message:'Effect already exists; update its metadata instead.'});
  const effect=await AREffect.create({...data,updatedBy:req.user.id});res.status(201).json({success:true,data:effect});
}));
arAdminRouter.put('/effects/:id',wrap(async(req:any,res:any)=>{
  const data=payload(req,res);if(!data)return;
  if(data.id!==req.params.id)return res.status(400).json({success:false,message:'Effect ID cannot change'});
  const existing=(await catalog()).find(effect=>effect.id===req.params.id);
  if(!existing)return res.status(404).json({success:false,message:'Effect not found'});
  const effect=await AREffect.findOneAndUpdate({id:data.id},{$set:{...data,deleted:false,updatedBy:req.user.id}},{upsert:true,new:true,runValidators:true});res.json({success:true,data:effect});
}));
arAdminRouter.patch('/effects/:id/status',wrap(async(req:any,res:any)=>{
  if(typeof req.body.active!=='boolean')return res.status(400).json({success:false,message:'active must be boolean'});
  const existing=(await catalog()).find(effect=>effect.id===req.params.id && !effect.deleted);
  if(!existing)return res.status(404).json({success:false,message:'Effect not found'});
  const {createdAt,updatedAt,...metadata}=existing;
  const effect=await AREffect.findOneAndUpdate({id:req.params.id},{$set:{...metadata,active:req.body.active,updatedBy:req.user.id}},{upsert:true,new:true,runValidators:true});res.json({success:true,data:effect});
}));
arAdminRouter.delete('/effects/:id',wrap(async(req:any,res:any)=>{
  const existing=(await catalog()).find(effect=>effect.id===req.params.id && !effect.deleted);
  if(!existing)return res.status(404).json({success:false,message:'Effect not found'});
  const {createdAt,updatedAt,...metadata}=existing;
  await AREffect.findOneAndUpdate({id:req.params.id},{$set:{...metadata,active:false,deleted:true,updatedBy:req.user.id}},{upsert:true,runValidators:true});res.json({success:true,message:'Effect disabled. Bundled offline metadata remains available.'});
}));
