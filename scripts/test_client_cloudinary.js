const cloudinary = require('cloudinary').v2;
const fs = require('fs');

const cloud_name = 'dinjtxdtj';
const api_key = '698671159281533';
const api_secret = 'XE_4TqPrwPL0j4vvFCnRwX8ewa0';

const timestamp = Math.round(new Date().getTime() / 1000);
const folder = 'avatars';
const public_id = `user123_avatar_${timestamp}_test`;

const paramsToSign = {
    timestamp,
    folder: folder,
    public_id: public_id,
};

const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    api_secret
);

console.log("Generated signature:", signature);

async function testFetch() {
  const formData = new FormData();
  const blob = new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")], { type: 'image/png' });
  formData.append('file', blob, 'test.png');
  formData.append('api_key', api_key);
  formData.append('timestamp', timestamp.toString());
  formData.append('signature', signature);
  formData.append('public_id', public_id);
  formData.append('folder', folder);

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud_name}/auto/upload`, {
      method: 'POST',
      body: formData,
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();
    console.log("Fetch Status:", res.status);
    console.log("Fetch Result:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Fetch Error:", err);
  }
}

testFetch();
