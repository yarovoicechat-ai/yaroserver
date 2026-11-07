const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

for (const type of ['King', 'Svip']) {
  test(`${type}: deleting the final tier stays deleted after public and admin refresh`, async () => {
    const filename = type === 'King' ? 'kingPlan.controller.ts' : 'svipPlan.controller.ts';
    const source = fs.readFileSync(path.join(__dirname, '../controllers', filename), 'utf8');
    let rows = [{ _id: 'last-tier', name: 'Test tier' }];
    let inserts = 0;
    const model = {
      countDocuments: async () => rows.length,
      insertMany: async () => { inserts++; rows = [{ _id: 'seeded', tierLevel: 1 }]; },
      findByIdAndDelete: async id => { const row = rows.find(item => item._id === id); rows = rows.filter(item => item._id !== id); return row; },
      find: () => ({ sort: () => ({ lean: async () => rows }) }),
    };
    const load = name => {
      const start = source.indexOf(`export const ${name} =`);
      assert.ok(start >= 0);
      const end = source.indexOf('export const ', start + 1);
      const module = { exports: {} };
      vm.runInNewContext(ts.transpileModule(source.slice(start, end < 0 ? undefined : end), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText, { exports: module.exports, module,
        [type === 'King' ? 'KingTier' : 'SvipTier']: model,
        DEFAULT_KING_TIERS: [], DEFAULT_SVIP_TIER_PLANS: [],
        sendResponse: (_, status, success, message, data) => ({ status, success, message, data }),
      });
      return module.exports[name];
    };
    const deleted = await load(`adminDelete${type}Plan`)({ params: { id: 'last-tier' } }, {});
    assert.equal(deleted.status, 200);
    for (const handler of [`getPublished${type}Plans`, `adminList${type}Plans`]) {
      const response = await load(handler)({ query: {} }, {});
      assert.equal(response.status, 200);
      assert.equal(response.data.plans.length, 0);
    }
    assert.equal(inserts, 0, 'GET requests must not recreate deleted tiers');
    const missing = await load(`adminDelete${type}Plan`)({ params: { id: 'last-tier' } }, {});
    assert.equal(missing.status, 404);
  });
}

test('legacy VIP catalog reads do not recreate an empty SVIP catalog', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/vip.service.ts'), 'utf8');
  const start = source.indexOf('  static async seedInitialCatalog()');
  const end = source.indexOf('  /**', start + 1);
  const method = source.slice(start, end).replace('static async seedInitialCatalog(): Promise<void>', 'async function seedInitialCatalog()');
  let inserts = 0;
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(method + '\nexports.run = seedInitialCatalog;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports, console,
    VipId: { countDocuments: async () => 1 },
    SvipTier: { countDocuments: async () => 0, insertMany: async () => { inserts++; } },
    INITIAL_SVIP_TIERS: [], INITIAL_VIP_PACKAGES: [],
  });
  await module.exports.run();
  assert.equal(inserts, 0);
});
