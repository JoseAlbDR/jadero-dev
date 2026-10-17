#!/bin/bash
#
# deploy.sh: the one script the deploy user may run as root (sudoers drop-in
# /etc/sudoers.d/jadero-deploy). Installed root-owned, mode 755, as /srv/jadero/bin/deploy.sh.
#
# Usage: deploy.sh <env> <service> <version>
#
# WP-8 ships this stub: it validates its arguments and prints what it would do. WP-9 fills in the
# real steps (pull, migrate, up, health, rollback; ADR-049 restating ADR-048).
#
# The arguments were already checked by deploy-entry. They are checked again here because the
# sudoers rule names this path with no arguments, which lets the deploy user pass any: this script
# is the last gate before root acts on them (defense in depth). The checks are a copy of
# deploy-entry's on purpose, so the server holds no shared file that both scripts trust.

set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# The services release-please publishes today. `contact` joins when it ships.
readonly SERVICES="api agent web"
readonly USAGE='refused: expected "deploy.sh <env> <service> <version>"'
readonly VERSION_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'

# Prints the usage to stderr and exits 1.
refuse() {
  echo "$USAGE" >&2
  exit 1
}

[[ $# -eq 3 ]] || refuse

env_name="$1"
service="$2"
version="$3"

case "$env_name" in
  staging | prod) ;;
  *) refuse ;;
esac

case "$service" in
  "" | *" "*) refuse ;;
esac
case " $SERVICES " in
  *" $service "*) ;;
  *) refuse ;;
esac

[[ "$version" =~ $VERSION_RE ]] || refuse

echo "would deploy $service $version to $env_name"
