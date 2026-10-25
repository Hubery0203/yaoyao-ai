# Private encrypted backups (009D)

This is a local/host CLI, not a scheduled backup service. The owner deferred the offsite destination. Nothing is uploaded, installed or scheduled automatically. An encrypted file on the same machine is **not** offsite disaster recovery. Keep a separate protected copy of the key outside the host before relying on this tool.

Use the bundled Node 24 runtime. All examples require a dedicated 0700 directory. Existing files/output directories are refused; no live database restore or source removal is performed.

```sh
node tools/backup/backup.mjs key --out /private-backup/archive.key
node tools/backup/backup.mjs encrypt --key-file /private-backup/archive.key --manifest /private-backup/inputs.json --out /private-backup/snapshot.yyb
node tools/backup/backup.mjs restore --key-file /private-backup/archive.key --archive /private-backup/snapshot.yyb --out /private-backup/new-restore
```

`inputs.json` explicitly selects already-created, quiescent private files (0600). No recursive discovery of home directories, credentials or SSH keys. Example:

```json
{"entries":[
 {"name":"database.dump","path":"/private-backup/database.dump"},
 {"name":"runtime.env","path":"/private-backup/runtime.env"},
 {"name":"weixin.json","path":"/private-backup/weixin.json"},
 {"name":"reference.png","path":"/private-backup/reference.png"},
 {"name":"release.json","path":"/private-backup/release.json"}
]}
```

Create the database dump using `pg_dump -Fc` from a compatible PostgreSQL client. Snapshot runtime configuration, the Weixin credentials referenced by it, the canonical photo reference and release/migration checksums deliberately; do not put the encryption key in the manifest or upload it beside ciphertext. A live database restore needs a separate explicit maintenance authorization, not this tool's `restore` command.

Format: `YAOYAO1\n` + random 96-bit nonce + AES-256-GCM ciphertext + 128-bit tag; the header is AAD. Key is exactly 32 random bytes from a private file, not a password. Encrypted payload contains a bounded length-prefixed manifest and sequential file bytes. Manifest names, sizes and SHA256s are authenticated. Maximum total input 1GiB, 32 top-level names, 64KiB manifest; no paths/links/devices in output. Sources are read through no-follow pinned descriptors and rehashed while encrypting; any changed/truncated input prevents publication. Archive publication uses an atomic no-overwrite link.

Restore reserves a NEW 0700 output directory. Unauthenticated plaintext is held only under its private `.staging` subdirectory, never exposed as completed restored files. Full GCM authentication and all sizes/hashes must pass before file promotion. `RESTORED.json` is written last. Any failure removes only the newly created output directory; existing paths are never removed or overwritten. Consumers must wait for successful completion/receipt, not read `.staging`. Plaintext staging/output must be on trusted private storage; encrypted disk volumes and physical/media security remain the operator's responsibility.

## Isolated database recovery checklist

1. Use a disposable empty PostgreSQL16+pgvector database. Do not point to production. Provision the same four least-privilege NOLOGIN roles from the repository's initial migration (`yaoyao_app`, `yaoyao_readonly`, `yaoyao_migrate`, `yaoyao_breakglass`) on a fresh cluster; role passwords are not pg_dump objects.
2. Decrypt into a new private directory and verify the receipt. Inspect the custom-format archive with `pg_restore --list`.
3. Restore into that empty database with compatible pg_restore; preserve roles/grants/functions/RLS and migration checksums. Never replace a live database to test a backup.
4. Compare business-table row counts and canonical hashes, migrations, sequence values, current preferences, recent-life and photo reservations, and account/Weixin state. Prove the app role still has RLS. Store only counts/digests in the public acceptance report.
5. Verify runtime key/reference/config presence privately before reconnecting services. Start exactly one receiver only after an approved cutover; never run a restored clone with the real Weixin token during a drill.

Successful crypto tests prove this envelope's checks, not arbitrary production recovery or successful offsite storage. 009D acceptance uses a real dump restored into a disposable database and reports that scope explicitly.

Primitive reference: https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html
