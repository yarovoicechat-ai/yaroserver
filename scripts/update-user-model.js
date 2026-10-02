const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/models/user.model.ts');
let content = fs.readFileSync(filePath, 'utf8');

if (!content.includes('equippedEntryEffect')) {
  const target = 'frameId: { type: String, default: "" },';
  const addition = `frameId: { type: String, default: "" },
    equippedEntryEffect: { type: Schema.Types.ObjectId, ref: 'EntryEffect', default: null },
    equippedEntryTag: { type: String, default: "" },
    ownedEntryEffects: [{ type: Schema.Types.ObjectId, ref: 'EntryEffect' }],`;
  
  if (content.includes(target)) {
    content = content.replace(target, addition);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Successfully added entry effect fields to user.model.ts');
  } else {
    console.error('Target not found in user.model.ts');
  }
} else {
  console.log('Fields already present in user.model.ts');
}
