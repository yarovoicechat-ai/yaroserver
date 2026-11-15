export const AR_CATEGORIES = ['Beauty','Animals','Accessories','Fantasy','Anime','Emotions','Nature','Party','Premium','Special'] as const;
export function validateAREffect(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Effect metadata must be an object');
  const data = input as Record<string, unknown>;
  const text=(key:string,pattern:RegExp,max:number) => { const value=data[key]; if(typeof value!=='string' || value.length>max || !pattern.test(value)) throw new Error(`Invalid ${key}`); return value; };
  const id=text('id',/^[a-z0-9]+(?:-[a-z0-9]+)*$/,80);
  const name=text('name',/\S/,80);
  const version=text('version',/^\d+\.\d+\.\d+$/,32);
  if(!AR_CATEGORIES.includes(data.category as any)) throw new Error('Invalid effect category');
  if(!Array.isArray(data.platforms) || !data.platforms.length || data.platforms.some(platform=>!['android','ios'].includes(platform))) throw new Error('Invalid platforms');
  if(typeof data.premium!=='boolean' || typeof data.active!=='boolean') throw new Error('premium and active must be boolean');
  if(!['pending','experimental','verified'].includes(String(data.status))) throw new Error('Invalid status');
  const url=(key:string) => {
    if(data[key]===null || data[key]===undefined || data[key]==='') return null;
    if(typeof data[key]!=='string' || (data[key] as string).length>2048) throw new Error(`Invalid ${key}`);
    const parsed=new URL(data[key] as string);
    if(parsed.protocol!=='https:' || parsed.username || parsed.password) throw new Error(`${key} must use HTTPS without credentials`);
    return parsed.toString();
  };
  const thumbnailUrl=url('thumbnailUrl'),assetUrl=url('assetUrl');
  const assetHash=data.assetHash===null || data.assetHash===undefined ? null:text('assetHash',/^[a-f0-9]{64}$/,64);
  if(data.status!=='pending' && (!thumbnailUrl || !assetUrl || !assetHash)) throw new Error('Available effects require thumbnail, asset URL and SHA-256');
  return { id,name,version,category:String(data.category),platforms:[...new Set(data.platforms as string[])],premium:data.premium,active:data.active,status:String(data.status),thumbnailUrl,assetUrl,assetHash };
}
