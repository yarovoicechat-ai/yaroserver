import mongoose from 'mongoose';
import { reconciliationReport } from '../economy/reconciliation';

/** Explicit connection only: does not load .env or assume the live database. No writes. */
export async function generateEconomyReport() {
  const uri = process.env.ECONOMY_REPORT_URI;
  if (!uri) throw new Error('Set ECONOMY_REPORT_URI explicitly to the approved snapshot/staging database');
  try {
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
    return await reconciliationReport();
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) generateEconomyReport()
  .then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n'))
  .catch(() => { console.error('Economy report failed. Check the explicit database selection, replica set, permissions and schema.'); process.exitCode = 1; });
