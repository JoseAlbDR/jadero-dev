# Environment of web on the servers (infra/compose/compose.services.yml). WP-9 step 2, ADR-043,
# ADR-053.
#
# web holds no secret today, so this template has no 1Password reference; it is rendered by
# deploy.sh like the others (`op inject` into /srv/jadero/<env>/web.env, mode 600), so a secret
# added later follows the same path. SITE_URL differs per environment and lives in the overlays
# (compose.staging.yml, compose.prod.yml); NODE_ENV, PORT and HOSTNAME come from the image.

NODE_ENV=production
# The content API over the environment's network, read per request by the server: the api of the
# same project, never the other environment's.
CONTENT_API_URL=http://api:3001
# The nonce CSP, enforced (ADR-047).
CSP_MODE=enforce
