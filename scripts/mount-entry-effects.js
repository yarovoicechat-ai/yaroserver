const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/index.ts');
let content = fs.readFileSync(filePath, 'utf8');

if (!content.includes('entryEffectRouter')) {
  // Add import
  const importTarget = 'import { giftRouter, adminGiftRouter } from "./gift/gift.routes";';
  const importAddition = `import { giftRouter, adminGiftRouter } from "./gift/gift.routes";\nimport { entryEffectRouter } from "./routes/entryEffect.routes";`;
  content = content.replace(importTarget, importAddition);

  // Add route mount
  const routeTarget = 'app.use("/api/gifts", giftRouter);';
  const routeAddition = `app.use("/api/gifts", giftRouter);\napp.use("/api/entry-effects", entryEffectRouter);`;
  content = content.replace(routeTarget, routeAddition);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Successfully mounted entryEffectRouter in index.ts');
} else {
  console.log('entryEffectRouter already mounted');
}
