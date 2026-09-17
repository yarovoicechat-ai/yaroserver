import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

const API_BASE = 'https://api.voicecallclub.com/api';
const BUCKET = (process.env.AWS_S3_BUCKET_NAME || 'talklivedata').trim();

async function main(): Promise<void> {
  try {
    console.log('1. Logging in as Admin...');
    const loginRes = await axios.post(`${API_BASE}/admin/login`, {
      email: 'admin@voicecallclub.local',
      password: 'admin@Owner'
    });

    console.log('Login Status:', loginRes.data.success, loginRes.data.message);
    const token = loginRes.data.data?.token || loginRes.data.token;
    if (!token) {
      throw new Error('No token returned from admin login!');
    }
    console.log('Admin Token Acquired Successfully!');

    const apkPath = path.resolve(__dirname, '../../VoiceCallClub-release.apk');
    console.log('2. Checking build APK file at:', apkPath);
    if (!fs.existsSync(apkPath)) {
      throw new Error(`APK file not found at ${apkPath}`);
    }

    const fileSizeMB = (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(2);
    console.log(`APK File found! Size: ${fileSizeMB} MB`);

    const fileKey = `releases/VoiceCallClub-v1.9.2-${Date.now()}.apk`;
    console.log(`3. Uploading APK to AWS S3 Bucket (${BUCKET}) under key: ${fileKey}...`);
    const fileStream = fs.createReadStream(apkPath);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: fileKey,
        Body: fileStream,
        ContentType: 'application/vnd.android.package-archive'
      })
    );

    const s3Url = `https://${BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${fileKey}`;
    console.log('🎉 AWS S3 Upload Completed Successfully!');
    console.log('Direct AWS S3 URL:', s3Url);

    console.log('4. Registering Release on Live API (api.voicecallclub.com)...');
    const releaseRes = await axios.post(
      `${API_BASE}/v1/app-releases/upload`,
      {
        directUrl: s3Url,
        versionName: '1.8.3',
        versionCode: '22',
        releaseNotes: 'Production Build v1.8.3 with call and banner enhancements.',
        setAsActive: 'true'
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Release Registration Result:', releaseRes.data);
    console.log('🚀 SUCCESS! Latest Build v1.8.3 is NOW LIVE on Website & API!');
  } catch (err: any) {
    console.error('❌ Error during S3 release deployment:', err.response?.data || err.message || err);
  }
}

main();
