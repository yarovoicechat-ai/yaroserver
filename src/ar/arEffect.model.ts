import { Schema,model } from 'mongoose';
import { AR_CATEGORIES } from './arValidation';
const schema=new Schema({
  id:{type:String,required:true,unique:true},name:{type:String,required:true,maxlength:80},category:{type:String,enum:AR_CATEGORIES,required:true},
  version:{type:String,required:true},thumbnailUrl:{type:String,default:null},assetUrl:{type:String,default:null},assetHash:{type:String,default:null},
  platforms:[{type:String,enum:['android','ios']}],active:{type:Boolean,default:false},premium:{type:Boolean,default:false},
  status:{type:String,enum:['pending','experimental','verified'],default:'pending'},deleted:{type:Boolean,default:false},updatedBy:{type:Schema.Types.ObjectId,ref:'User'},
},{timestamps:true});
export default model('AREffect',schema);
