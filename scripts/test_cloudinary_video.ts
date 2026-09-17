import path from 'path';
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: 'dinjtxdtj',
  api_key: '698671159281533',
  api_secret: 'XE_4TqPrwPL0j4vvFCnRwX8ewa0',
  secure: true
});

async function main(): Promise<void> {
  try {
    const apkPath = path.resolve(__dirname, '../../VoiceCallClub-release.apk');
    console.log('Uploading APK as resource_type video to bypass raw limit...');
    const result = await cloudinary.uploader.upload(apkPath, {
      resource_type: 'video',
      folder: 'app_releases',
      public_id: 'VoiceCallClub-v1.9.2-build.apk'
    });

    console.log('🎉 Cloudinary Video Upload SUCCESS!');
    console.log('URL:', result.secure_url);
  } catch (err: any) {
    console.error('❌ Cloudinary Video Upload Error:', err.message || err);
  }
}

main();
