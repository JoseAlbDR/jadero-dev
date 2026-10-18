# Secrets of the nightly backup (infra/scripts/backup.sh, its weekly check and
# infra/scripts/restore.sh). WP-8 D7, ADR-051 restating ADR-050 "Backup destination", ADR-043.
#
# Only 1Password secret references, never a value: vault `jadero-ops`, items `backup-b2` (the B2
# key and bucket), `backup-restic` (the repository password) and `uptime-kuma-backup-push-url`.
# Their fields and how to fill them are in docs/runbooks/restore.md, "One-time setup".
#
# Rendered on the server, as root, never into the repo:
#
#   OP_SERVICE_ACCOUNT_TOKEN="$(cat /etc/jadero/op-token)" \
#     op inject --force -i infra/env/backup.env.tpl -o /etc/jadero/backup.env
#
# `op inject` writes the output with mode 600; the file stays root's, and backup.sh refuses to
# read it when anyone else can. On the owner's laptop (a restore without the server), render it
# into restore.sh's input only, never to a file:
#
#   infra/scripts/restore.sh --env-file <(op inject -i infra/env/backup.env.tpl) snapshots
#
# The file is read by a shell (`set -a; . file`): the two URLs are in single quotes, because the
# push URL carries `&`, which a shell would read as "run in the background".

# The restic repository: s3:https://s3.<region>.backblazeb2.com/<bucket> (Backblaze B2, EU
# Central, through restic's S3 backend; the region code is on the bucket's details page).
RESTIC_REPOSITORY='s3:https://{{ op://jadero-ops/backup-b2/endpoint }}/{{ op://jadero-ops/backup-b2/bucket }}'
# The repository password: restic encrypts everything with it before it leaves the server.
# Without it the backups cannot be read, so it lives in 1Password, never only on the server.
RESTIC_PASSWORD={{ op://jadero-ops/backup-restic/password }}

# The B2 application key restricted to the backup bucket (restic's S3 backend reads these names).
AWS_ACCESS_KEY_ID={{ op://jadero-ops/backup-b2/username }}
AWS_SECRET_ACCESS_KEY={{ op://jadero-ops/backup-b2/credential }}

# The Uptime Kuma push monitor of the nightly run, on Kuma's local port
# (http://127.0.0.1:3101/api/push/<token>?status=up&msg=OK&ping=): nginx does not open the push
# path on status.jadero.dev. The token is a secret: backup.sh never prints the URL.
BACKUP_HEARTBEAT_URL='{{ op://jadero-ops/uptime-kuma-backup-push-url/password }}'

# Optional: a second push monitor for the weekly `restic check` (the runbook says when to add
# it). Once its item exists, add the BACKUP_CHECK_HEARTBEAT_URL line the runbook gives.
# `op inject` resolves a secret reference anywhere in this file, comments included, with or
# without braces, so no comment here holds one.
