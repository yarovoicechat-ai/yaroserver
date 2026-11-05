// Run from YaroServer using its configured database. Read-only unless --apply is given.
// Supply OPERATOR_EMAIL/OPERATOR_PASSWORD in the environment, or JSON on stdin with --stdin.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function main() {
  const credentials = process.argv.includes('--stdin')
    ? JSON.parse(require('node:fs').readFileSync(0, 'utf8')) : {};
  const email = (credentials.email || process.env.OPERATOR_EMAIL || '').trim().toLowerCase();
  const password = credentials.password || process.env.OPERATOR_PASSWORD;
  const apply = process.argv.includes('--apply');
  if (!email || !password) throw Error('OPERATOR_EMAIL and OPERATOR_PASSWORD are required');
  const uri = process.env.MONGODB_URI;
  if (!uri || new URL(uri).pathname !== '/yaro_live') throw Error('Expected configured yaro_live database');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 6000, connectTimeoutMS: 6000 });
  const users = mongoose.connection.collection('users');
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let matches = await users.find({ email: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' },
    role: { $in: ['operator', 'OPERATOR'] }, isDeleted: { $ne: true },
  }).project({ _id: 1, userId: 1, email: 1, role: 1, password: 1, isBlocked: 1, isActive: 1 }).toArray();
  if (!matches.length && apply && process.argv.includes('--create-missing-operator')) {
    // Explicit offline recovery only; the public login endpoint cannot provision users.
    if (!credentials.ownerId || !credentials.expectedAppUserId) throw Error('Owner and expected app user ID are required for recovery');
    const { User } = require('../dist/models/user.model');
    const { createEmployee } = require('../dist/controllers/adminAuthController');
    const { AuditLog } = require('../dist/models/auditLog.model');
    const owner = await User.findOne({ _id: credentials.ownerId, role: 'owner', isBlocked: false, isDeleted: false });
    const app = await User.findOne({ email, userId: credentials.expectedAppUserId, role: { $in: ['user', 'host', 'USER', 'HOST'] }, isDeleted: false }).select('+password');
    if (!owner || !app || app.isBlocked) throw Error('Recovery owner or source app account is unavailable');
    const before = JSON.stringify([app.role, app.password, app.coins, app.diamonds]);
    let result;
    const res = { status() { return this; }, json(body) { result = body; } };
    await createEmployee({ user: { role: owner.role, id: owner._id, userId: owner.userId }, body: {
      targetRole: 'operator', name: app.name || 'Operator', email, password, phoneNumber: app.phoneNumber, country: app.country,
    } }, res);
    if (!result?.success) throw Error('Operator provisioning failed');
    const panel = await User.findOne({ email, role: 'operator', isDeleted: false });
    await User.updateOne({ _id: panel._id }, { $set: { yaroId: String(app.userId) } });
    await AuditLog.create({ adminId: owner._id, action: 'operator_login_repair', target: String(panel._id),
      details: 'Separate operator panel identity restored by explicitly authorized server repair; existing app account preserved.',
      reason: 'App/panel identity collision recovery', newValue: { userId: panel.userId, appUserId: app.userId, role: 'operator' },
    });
    const savedApp = await User.findById(app._id).select('+password');
    if (JSON.stringify([savedApp.role, savedApp.password, savedApp.coins, savedApp.diamonds]) !== before) throw Error('App identity changed concurrently; review required');
    matches = await users.find({ _id: panel._id }).toArray();
    console.log(JSON.stringify({ restoredOperatorUserId: panel.userId, preservedAppUserId: app.userId }));
  }
  if (matches.length !== 1) {
    const related = await users.find({ email: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' } })
      .project({ userId: 1, role: 1, appRole: 1, isDeleted: 1, isBlocked: 1, isActive: 1 }).toArray();
    console.log(JSON.stringify({ operatorAccounts: matches.length, relatedAccounts: related }));
    throw Error('Expected one operator account. Resolve provisioning/duplicates through the owner panel.');
  }
  const user = matches[0];
  if (user.isBlocked || user.isActive === false) throw Error('Account is blocked/inactive; owner review is required');
  const passwordMatches = !!user.password && await bcrypt.compare(password, user.password).catch(() => false);
  console.log(JSON.stringify({ userId: user.userId, role: user.role, passwordMatches, emailNeedsNormalization: user.email !== email, apply }));
  if (!apply) return;
  const update = { email };
  if (!passwordMatches) {
    update.password = await bcrypt.hash(password, 6);
    update.activeToken = '';
    update.refreshToken = '';
  }
  const result = await users.updateOne({ _id: user._id, password: user.password ?? { $exists: false },
    isDeleted: { $ne: true }, isBlocked: { $ne: true }, isActive: { $ne: false }, role: user.role,
  }, { $set: update });
  if (result.matchedCount !== 1) throw Error('Account changed during repair; rerun the read-only check');
  const saved = await users.findOne({ _id: user._id }, { projection: { password: 1, email: 1 } });
  if (saved.email !== email || !await bcrypt.compare(password, saved.password)) throw Error('Repair verification failed');
  console.log('Operator credentials verified. Verify the admin login API after deploying the auth fix.');
}
main().catch(() => { console.error('Operator repair failed. Check account uniqueness/status, database configuration and connectivity. No credentials are printed.'); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); });
