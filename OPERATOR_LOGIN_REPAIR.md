# Operator login repair

The reported email had only a host/app record in production; no separate operator
record remained. Google app auth could reuse a panel identity when no app account
existed, allowing app host/profile flows to mutate that identity and its session.
The supported identity rule is one app account and one panel account per email
and phone number, with separate user IDs, passwords and sessions.

Local fixes:
- Approval honors `passwordBeforeApproval`, `data.password`, or
  `data.accountPassword`, and trims the email before saving.
- Login verifies the saved hash, without provisioning accounts, replaying
  approvals, accepting role defaults, or changing passwords on failed attempts.
- Google/phone app auth and account linking select only app roles. Host status,
  host approval and profile role changes cannot convert panel identities.
- Unique indexes group all app roles together and all panel roles together,
  rather than allowing one duplicate for each role. Empty identifiers are excluded.
- Panel phone duplicate checks use the panel scope; panel deletion leaves the
  independent Firebase app identity intact.
- `npm run test:admin-login` covers repeated successful login, wrong passwords,
  missing accounts, blocked accounts, malformed inputs and malformed hashes, plus
  app signup/login with an existing panel identity and legacy-token host access.

Before reloading production, build and run
`node scripts/migrate-account-identity-indexes.cjs --apply`. The script audits
duplicates, creates all four stronger indexes, then removes only the three
obsolete per-role indexes. It never deletes account records. CI runs the auth
regressions and deployment runs this idempotent migration before reload.

On the authorized deployment host, from YaroServer:
1. Set `OPERATOR_EMAIL` and `OPERATOR_PASSWORD` in the process environment through
   a secure prompt. Do not put the password in command history or a file.
2. Run `node scripts/repair-operator-login.cjs` for read-only diagnosis.
3. If exactly one active operator is found, run
   `node scripts/repair-operator-login.cjs --apply` to normalize its email and
   synchronize the password. Changed passwords revoke saved sessions. The script
   verifies the resulting hash and refuses duplicate, missing or blocked accounts.
   For explicitly authorized recovery of a missing panel identity, JSON stdin
   with `--stdin --apply --create-missing-operator` must also supply `ownerId` and
   `expectedAppUserId`. Recovery uses the standard employee creation flow,
   preserves the app's role, password and balances, and writes an audit entry.
4. Deploy the reviewed auth changes using the normal build/reload procedure.
5. Test the real admin login twice and test rejection with an incorrect password.
   Do not print tokens or credentials. Clear the temporary environment variables.

The public login endpoint deliberately cannot create or promote accounts.
