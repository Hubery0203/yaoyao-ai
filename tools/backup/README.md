# 010D ciphertext repository and recovery

These tools do not discover accounts, create server users, install keys or schedules, rotate credentials, call models or restore a live DB. All example values are placeholders. Server installation requires the operator's scoped approval.

## Source and key custody

Reuse the existing once-daily Tokyo database backup timer, after its successful fresh `pg_dump -Fc` and `pg_restore --list`; serialize release/config/credential rotation with snapshot creation. A dump is transaction-consistent within PostgreSQL; configuration files are separate captures and are not claimed to be an atomic distributed snapshot.

Create a 32-byte AES key using `backup.mjs key --out PRIVATE_FILE` only after approval. Verify a second private copy on the operator's Mac before enabling retention. Upload-only SSH key and AES key are separate. Neither the AES key nor plaintext DB/config/Weixin credentials go to the US machine. The US root recovery SSH key stays on the Mac. Losing every copy of the AES key makes archives unrecoverable.

A private 0600 snapshot JSON in a 0700 folder explicitly names `dump`, `apiEnv`, `weixinAuth`, `reference`, `release`, `keyFile`, `out`. Run `node snapshot-cli.mjs --config PRIVATE_CONFIG`. All five inputs must be regular private files; fresh custom dump <=1h; total payload <=48MiB. Capture a private copy of RELEASE.json if its deployed original is public-readable. No directory scanning or image-spool collection. Snapshot output cannot overwrite an existing path. The key inode cannot be a payload. Temporary plaintext copies are removed after success/failure (normal file removal, no secure-erasure claim).

## Restricted SSH receiver

On US: dedicated unprivileged `yaoyao-backup` user and private directory `/var/lib/yaoyao-backup/ciphertext` (0700), root-owned receiver `/usr/local/lib/yaoyao-backup/receiver.py` and root-owned config `/etc/yaoyao-backup-receiver.json` (0644, only directory/namespace; no secrets).

Config: `{"directory":"/var/lib/yaoyao-backup/ciphertext","namespace":"32_RANDOM_LOWERCASE_HEX"}`. Namespace must match the private Tokyo client JSON. Initialize only an empty repository through `offsite-cli.mjs init --config PRIVATE_CONFIG`. No writes outside the dedicated directory, no general remote shell.

The upload public key's authorized_keys entry must restrict source to Tokyo:

```
from="8.216.54.161",restrict,command="/usr/bin/nice -n 15 /usr/bin/python3 /usr/local/lib/yaoyao-backup/receiver.py" ssh-ed25519 PUBLIC_KEY
```

Provision this user's locked-password account with SSH public-key access using the host's existing policy. Do not change/restart sshd, proxy or nginx. The receiving account must not own receiver/config/authorized_keys. Test that a shell command, PTY, forwarding and SFTP cannot run under this key before enabling the scheduled job. No root/admin key is copied from Mac to Tokyo.

Client JSON (0600, 0700 parent): `driver:"ssh"`, `host:"164.92.84.160"`, `user:"yaoyao-backup"`, `port:22`, `identityFile:"ABSOLUTE_PRIVATE_UPLOAD_KEY"`, `knownHostsFile:"ABSOLUTE_PINNED_HOSTS"`, `namespace:"32_RANDOM_LOWERCASE_HEX"`. Obtain the host key through the already trusted admin connection and verify its fingerprint; unknown/changed keys must fail, never auto-accept. Client disables forwarding, ProxyCommand/ProxyJump and connection multiplexing.

Receiver serializes requests and enforces <=64MiB per object, <=512MiB committed plus abandoned-upload files, <=1000 named objects. Full capacity fails closed, without deleting old backups. Abandoned `.upload-*` files after a crash count toward capacity and require assessed manual cleanup. This application cap is not a filesystem quota against a compromised US administrator.

## Publish, verify, retain

```
node offsite-cli.mjs publish --config PRIVATE_CONFIG --archive PRIVATE_ARCHIVE --key-file PRIVATE_KEY --receipt NEW_PRIVATE_RECEIPT
node offsite-cli.mjs verify --config PRIVATE_CONFIG --receipt PRIVATE_RECEIPT --key-file PRIVATE_KEY --out NEW_PRIVATE_VERIFICATION
node offsite-cli.mjs retain --config PRIVATE_CONFIG --receipt PRIVATE_VERIFICATION --keep 7
```

Publication pins the source descriptor, uploads ciphertext atomically without overwrite, re-downloads it, checks SHA256 and decrypts in a new private temporary directory to authenticate the GCM tag and manifest. Only then is a success receipt written. A failed operation leaves its `.pending` plan; replay uses the same `--name` from that plan, archive, key and receipt. A different plan is rejected. No automatic regeneration or network retries.

Retention defaults to preview. `--apply` additionally requires a <=30min authenticated receipt, exact repository ID, unchanged verified object and hash-checked candidates. It preserves the verified archive and at least the newest two. Enable seven-archive pruning only after independent Mac key escrow is confirmed by the operator; the tool's `keyEscrowVerified:false` deliberately does not claim escrow from a local check. Unknown files never become deletion candidates. A compromised remote host can delete backups; this is not immutable/WORM storage.

## Disaster recovery (explicit operator runbook)

1. Keep production API/Weixin running where it is; do not restore into its database, current release or photo directory. Use an isolated disposable machine/cluster, no public ports, no receiver, no external API calls. Ensure compatible PostgreSQL16 + pgvector0.8.0 and the recorded application release.
2. From the operator Mac, retrieve the desired ciphertext and successful receipt using the existing trusted US admin SSH connection. This works independently of Tokyo's source-restricted upload key. Verify receipt hash/repository identity and separately held AES key. `backup.mjs restore --archive PRIVATE_DOWNLOAD --key-file ESCROW_COPY --out NEW_PRIVATE_DIR` authenticates before promoting plaintext files. Keep original ciphertext untouched.
3. Inspect `RESTORED.json` (all five files), release metadata and dump archive listing. Restore into a NEW database with `pg_restore --exit-on-error`, preserving owners/grants; bootstrap `yaoyao_admin` plus NOLOGIN `yaoyao_migrate`, `yaoyao_app`, `yaoyao_readonly`, `yaoyao_breakglass` as needed. Never use `--clean` against production. Extensions, schemas, migrations, rows, sequences and RLS policies must agree with the source baseline.
4. Compare table counts and deterministic data digests, sequence state, migration checksums/head, channel binding/cursor/inbox/outbox/photo states, RLS enable/force/policies/grants. Test owner isolation with synthetic accounts. Do not print conversation text, tokens, media AES keys or environment values in the evidence.
5. Configuration paths are evidence, not ready-to-run config: rewrite DB URL, reference/spool paths and permissions for the new host. Never load restored api.env or Weixin token into a running service during the drill. API/Weixin/outreach must remain disabled. Validate reference bytes/ownership and auth file existence offline only.
6. Record results separately: download/authentication, key escrow, isolated PostgreSQL restoration and actual service cutover are different acceptance gates. Local protocol doubles prove none of the remote gates. Dispose only the drill's new resources after inspection. Production cutover requires a separate approved plan that prevents dual Weixin receivers and preserves cursors.

Status this release: automated local crypto/protocol/namespace/retention/snapshot tests; real US write, key escrow and isolated production-data restore are pending deployment approval. Image generation/mobile receipt also remain deferred until credit is replenished.

## Ready-to-install timer hook

`deploy/vps-lite/offsite/backup-override.conf` adds ExecStartPost to the existing `yaoyao-backup.service`, with a finite timeout and short-lived backup process limits. It does not add another timer or change API/proxy limits. Its private JSON needs `dumpDirectory`, `workspace` (existing0700), `releaseFile`, `apiEnv`, `weixinAuth`, `reference`, `keyFile`, `repositoryConfig`, `keyEscrowConfirmed:true`; `applyRetention` defaults false. It uses only explicitly named paths and the newest promoted dump in the dedicated dump directory; stale dump fails. Release/config fingerprints must remain stable through capture. Failed encrypted runs count toward a128MiB spool cap and need assessed cleanup; successful runs keep private receipts but remove local duplicate ciphertext. Receipt directories contain no plaintext credentials.

`node restore-drill.mjs --config PRIVATE_DRILL_JSON` automates authenticated extraction and a fresh socket-only PG cluster using `pgBin`, `workspace`, `archive`, `keyFile` and optional `expectedFingerprint`/`keepWorkspace`. It stops the cluster and removes only its own fresh tree by default. Requires local PostgreSQL16 binaries plus vector/citext extensions; do not run as root. It records table counts and migration/policy/sequence metadata. It explicitly reports `contentDigestsCompared:false`; a real source baseline, owner isolation checks and data-level comparison remain required before claiming disaster recovery. Local2026-10-26 synthetic drill restored28tables/12rows; no production backup or real US storage was used.


## Online source-content evidence (offsite recovery follow-up)

`capture.mjs` accepts explicit private operator command arrays (`psqlCommand`, `dumpCommand`) and new `out`/`evidenceOut` paths. It opens one read-only repeatable-read source transaction, exports its snapshot, hashes sorted SHA256 JSONB row hashes for every public base table, and runs `pg_dump -Fc --snapshot` against the same snapshot. New writes may continue and are excluded from that snapshot. The source transaction and dump are bounded to120s, individual statements to30s and48MiB custom dump output. No shell interpolation or automatic credential discovery is used. Database CPU/IO still increases briefly; client resource limits do not impose a PostgreSQL server query CPU quota.

A private `captureConfig` in daily JSON enables this path. The existing local backup ExecStart remains intact; ExecStartPost creates a second consistent offsite-only dump, embeds authenticated source evidence in private release metadata and cleans temporary plaintext on ordinary success/failure. This extra dump is intentional so the existing local backup is not replaced. `deploymentMetadataFile` explicitly captures the derived-release identity. Archive format and its five payload names remain unchanged. Successful source evidence is bound to the exact dump SHA256 inside the authenticated encrypted archive. Interrupted plaintext files stay private; all files in failed run subtrees now count toward the128MiB spool ceiling.

With `requireContentEvidence:true`, `restore-drill.mjs` requires these source hashes, compares every table's contents plus schema/constraints/indexes/grants/extensions/RLS definitions, checks increasing non-cycling owned sequences cannot reuse restored identifiers, and tests two available owners under the unprivileged RLS role. Sequence current values are not MVCC data: concurrent source writes may advance them beyond rows in the dump; the drill checks safe next values rather than incorrectly demanding an exact live sequence value. Legacy archives remain readable without claiming content comparison; production acceptance must require the evidence flag. No owner identifiers or row text are emitted in reports.

Local follow-up acceptance: real PostgreSQL16/pgvector capture with a concurrent source insert, authenticated five-file encryption and new socket-only restore passed31tables/38rows; the source probe had3live rows but the selected snapshot restored2. Source content/schema hashes,2-owner isolation and2owned sequence floors passed; a newly authenticated archive with a wrong expected content digest was rejected. These are synthetic local data, not a real US backup or production recovery. Server install, independent Mac key escrow and real US download/recovery still need the current scoped approval.

For a tools-only rollout use `deploy/vps-lite/offsite/backup-tools-override.conf.example`, replacing REVIEWED_COMMIT with the verified source commit in an independent `/opt/yaoyao-ai/backup-tools/` directory. Do not switch the live application's current symlink or install the older current-relative hook for this rollout. Configure `captureConfig` and `deploymentMetadataFile` explicitly. Existing local dump and04:35UTC timer remain intact; no API restart or schema change is necessary. The independent SSH client ignores user/global SSH configs and agents; only its explicit source-restricted upload key and pinned host file are used.

Source evidence now records `extensionVersions`. The drill initializes those exact extension versions before pg_restore rather than accepting the host's newer defaults; it still requires full metadata equality. A legacy authenticated archive without this field can use explicit `expectedExtensionVersions` from separately verified source metadata. Missing versioned SQL/library files fail closed: prepare compatible official extension binaries in the isolated restore runtime; do not upgrade production or normalize away the mismatch. The actual production drill exposed native Mac default vector0.8.6 versus source0.8.0. A dedicated official0.8.0 build and version-specific control/SQL were added alongside the private local Postgres bundle, without overwriting0.8.6. Production restoration then passed30tables/868rows, source content/schema equality,2-owner RLS checks and owned sequence safety, with no TCP/API/Weixin.
