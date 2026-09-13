#!/usr/bin/env bash
#
# Configure un realm OdyssAI sur Keycloak, uniquement via l'Admin REST API.
# Idempotent : relancer le script met le realm a jour, il ne le recree pas.
#
# Usage :
#   KC_ADMIN_PASSWORD='...' ./infra/keycloak/setup-realm.sh odyssai-dev
#
#   KC_ADMIN_PASSWORD='...' \
#   API_BASE_URL=https://api.odyssai.example \
#   WEB_BASE_URL=https://odyssai.example \
#     ./infra/keycloak/setup-realm.sh odyssai-prod
#
# Variables d'environnement :
#   KC_URL            (defaut: https://sso.joachimjasmin.com)
#   KC_ADMIN_REALM    (defaut: master)
#
#   Deux facons de s'authentifier, dans cet ordre de preference :
#
#   KC_ADMIN_CLIENT_ID / KC_ADMIN_CLIENT_SECRET
#                     service account du realm d'administration. A privilegier :
#                     insensible au MFA, revocable, et sans identite humaine
#                     partagee.
#   KC_ADMIN_USER / KC_ADMIN_PASSWORD
#                     compte humain. Echoue des que le compte porte du MFA, le
#                     direct grant ne sachant pas presenter un second facteur.
#   API_BASE_URL      (defaut: http://localhost:3001)  origine publique de apps/api
#   WEB_BASE_URL      (defaut: http://localhost:3000)  origine publique de apps/web
#   API_CLIENT_ID     (defaut: odyssai-api)
#   DISPLAY_NAME      (defaut: OdyssAI)  nom affiche dans la console et sur les
#                     pages de connexion. A distinguer entre environnements,
#                     sinon rien ne dit sur quel realm on est en train d agir.
#   EXTRA_REDIRECT_URIS  URI de redirection supplementaires, separees par des
#                     virgules. Sert au realm de developpement, ou la machine du
#                     developpeur doit etre acceptee a cote du domaine deploye.
#   LOGIN_THEME       (defaut: keycloak)  passer a "odyssai" une fois le theme deploye
#   SSL_REQUIRED      (defaut: all)  "external" si le proxy devant Keycloak ne
#                     transmet pas X-Forwarded-Proto (sinon boucle de redirection)
#
# Le realm ne contient volontairement aucun client public ni aucun service
# account : apps/api est le seul client, il est confidentiel, et il porte le
# flot Authorization Code + PKCE. Les mots de passe ne transitent jamais par
# l'API, ils ne sont vus que par les pages de Keycloak.
#
set -euo pipefail

KC_URL="${KC_URL:-https://sso.joachimjasmin.com}"
KC_URL="${KC_URL%/}"
KC_ADMIN_REALM="${KC_ADMIN_REALM:-master}"
KC_ADMIN_USER="${KC_ADMIN_USER:-}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-}"
KC_ADMIN_CLIENT_ID="${KC_ADMIN_CLIENT_ID:-}"
KC_ADMIN_CLIENT_SECRET="${KC_ADMIN_CLIENT_SECRET:-}"
API_BASE_URL="${API_BASE_URL:-http://localhost:3001}"
API_BASE_URL="${API_BASE_URL%/}"
WEB_BASE_URL="${WEB_BASE_URL:-http://localhost:3000}"
WEB_BASE_URL="${WEB_BASE_URL%/}"
API_CLIENT_ID="${API_CLIENT_ID:-odyssai-api}"
DISPLAY_NAME="${DISPLAY_NAME:-OdyssAI}"
EXTRA_REDIRECT_URIS="${EXTRA_REDIRECT_URIS:-}"
LOGIN_THEME="${LOGIN_THEME:-keycloak}"
SSL_REQUIRED="${SSL_REQUIRED:-all}"
REALM="${1:-}"

if [[ -z "$REALM" ]]; then
  echo "usage: KC_ADMIN_PASSWORD='...' $0 <realm>   (ex: odyssai-dev)" >&2
  exit 2
fi
if [[ -z "$KC_ADMIN_CLIENT_SECRET" && -z "$KC_ADMIN_PASSWORD" ]]; then
  cat >&2 <<'USAGE'
Aucun identifiant d'administration.

  Service account (recommande) :
    KC_ADMIN_CLIENT_ID=odyssai-provisioner KC_ADMIN_CLIENT_SECRET='...'

  Compte humain, impossible si le compte porte du MFA :
    KC_ADMIN_USER=admin KC_ADMIN_PASSWORD='...'
USAGE
  exit 2
fi
for bin in curl jq; do
  command -v "$bin" >/dev/null || { echo "$bin est requis" >&2; exit 2; }
done

log() { printf '   %s\n' "$*" >&2; }
step() { printf '\n== %s\n' "$*" >&2; }

# ---------------------------------------------------------------- token admin

step "Authentification sur $KC_URL (realm $KC_ADMIN_REALM)"

TOKEN_ENDPOINT="$KC_URL/realms/$KC_ADMIN_REALM/protocol/openid-connect/token"

# Appelee au demarrage, puis rappelee apres la creation d'un realm : Keycloak
# publie alors un client <realm>-realm portant les droits d'administration de
# ce realm, et les ajoute au role composite de l'appelant. Un jeton emis avant
# ne les porte pas, et tout ce qui suit repondrait 403.
authenticate() {
if [[ -n "$KC_ADMIN_CLIENT_SECRET" ]]; then
  AUTH_MODE="service account $KC_ADMIN_CLIENT_ID"
  AUTH_RESPONSE="$(curl -sS -X POST "$TOKEN_ENDPOINT" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=client_credentials' \
    --data-urlencode "client_id=$KC_ADMIN_CLIENT_ID" \
    --data-urlencode "client_secret=$KC_ADMIN_CLIENT_SECRET")"
else
  AUTH_MODE="compte $KC_ADMIN_USER"
  AUTH_RESPONSE="$(curl -sS -X POST "$TOKEN_ENDPOINT" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=password' \
    --data-urlencode 'client_id=admin-cli' \
    --data-urlencode "username=$KC_ADMIN_USER" \
    --data-urlencode "password=$KC_ADMIN_PASSWORD")"
fi

TOKEN="$(jq -re '.access_token // empty' <<<"$AUTH_RESPONSE" 2>/dev/null || true)"

if [[ -z "$TOKEN" ]]; then
  echo "echec de l'authentification ($AUTH_MODE) sur $KC_URL/realms/$KC_ADMIN_REALM" >&2
  echo "reponse : $(jq -rc '{error, error_description}' <<<"$AUTH_RESPONSE" 2>/dev/null || echo "$AUTH_RESPONSE")" >&2
  if [[ -z "$KC_ADMIN_CLIENT_SECRET" ]]; then
    echo "un compte protege par MFA ne peut pas passer par le direct grant : utiliser un service account" >&2
  fi
  exit 1
fi
}

authenticate
log "authentifie par $AUTH_MODE"

# api <METHODE> <CHEMIN> [CORPS_JSON] : renseigne HTTP_CODE et RESP_BODY.
# Volontairement sans sortie standard : une substitution de commande creerait
# un sous-shell et les deux variables seraient perdues au retour.
HTTP_CODE=""
RESP_BODY=""
LAST_CALL=""
api() {
  local method="$1" path="$2" body="${3:-}" out
  local args=(-sS -w $'\n%{http_code}' -X "$method"
    "$KC_URL$path" -H "Authorization: Bearer $TOKEN")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  LAST_CALL="$method $path"
  out="$(curl "${args[@]}")"
  HTTP_CODE="${out##*$'\n'}"
  RESP_BODY="${out%$'\n'*}"
}

# Arrete le script si le dernier appel n'a pas rendu un des codes attendus.
expect() {
  if [[ " $1 " != *" $HTTP_CODE "* ]]; then
    echo "echec sur $LAST_CALL (HTTP $HTTP_CODE) : $RESP_BODY" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------- realm

step "Realm $REALM"

REALM_CONFIG="$(jq -n \
  --arg realm "$REALM" \
  --arg display "$DISPLAY_NAME" \
  --arg theme "$LOGIN_THEME" \
  --arg ssl "$SSL_REQUIRED" '{
  realm: $realm,
  displayName: $display,
  enabled: true,

  # Inscription et connexion sont servies par Keycloak : c est ce qui permet a
  # apps/api de ne jamais manipuler de mot de passe.
  registrationAllowed: true,
  registrationEmailAsUsername: true,
  loginWithEmailAllowed: true,
  duplicateEmailsAllowed: false,
  editUsernameAllowed: false,
  resetPasswordAllowed: true,
  rememberMe: true,

  # Passer a true des que le SMTP du realm est configure. Sans SMTP, un compte
  # non verifie ne peut plus terminer de connexion.
  verifyEmail: false,

  loginTheme: $theme,
  sslRequired: $ssl,

  # Les pages de Keycloak suivent les locales de apps/web.
  internationalizationEnabled: true,
  supportedLocales: ["fr", "en"],
  defaultLocale: "fr",

  passwordPolicy: "length(12) and notUsername(undefined) and notEmail(undefined) and passwordHistory(3)",

  bruteForceProtected: true,
  permanentLockout: false,
  failureFactor: 10,
  waitIncrementSeconds: 60,
  maxFailureWaitSeconds: 900,
  quickLoginCheckMilliSeconds: 1000,
  minimumQuickLoginWaitSeconds: 60,

  accessTokenLifespan: 300,
  accessCodeLifespan: 60,
  ssoSessionIdleTimeout: 1800,
  ssoSessionMaxLifespan: 36000,
  ssoSessionIdleTimeoutRememberMe: 172800,
  ssoSessionMaxLifespanRememberMe: 2592000,

  # Rotation stricte : un refresh token ne sert qu une fois. Un rejeu signale
  # un vol de token et invalide la session.
  revokeRefreshToken: true,
  refreshTokenMaxReuse: 0,

  defaultSignatureAlgorithm: "RS256",
  browserSecurityHeaders: {
    contentSecurityPolicy: "frame-src '\''self'\''; frame-ancestors '\''none'\''; object-src '\''none'\''",
    xFrameOptions: "DENY",
    strictTransportSecurity: "max-age=31536000; includeSubDomains"
  }
}')"

api GET "/admin/realms/$REALM"
if [[ "$HTTP_CODE" == "200" ]]; then
  api PUT "/admin/realms/$REALM" "$REALM_CONFIG"
  expect "204"
  log "realm mis a jour"
else
  api POST "/admin/realms" "$REALM_CONFIG"
  expect "201"
  log "realm cree"
  authenticate
  log "jeton renouvele pour prendre les droits sur le nouveau realm"
fi

# --------------------------------------------------------------- user profile

step "Profil utilisateur (formulaire d inscription reduit)"

# firstName et lastName restent declares pour ne pas casser la console compte,
# mais deviennent invisibles et non modifiables cote utilisateur : le formulaire
# d inscription se limite a l email et au mot de passe. Le pseudo de joueur
# releve du profil de jeu, pas de l identite, il ira en base applicative.
USER_PROFILE="$(jq -n '{
  attributes: [
    {
      name: "username",
      displayName: "${username}",
      validations: {
        length: { min: 3, max: 255 },
        "username-prohibited-characters": {},
        "up-username-not-idn-homograph": {}
      },
      permissions: { view: ["admin", "user"], edit: ["admin"] },
      multivalued: false
    },
    {
      name: "email",
      displayName: "${email}",
      validations: { email: {}, length: { max: 255 } },
      # Sans cette annotation le formulaire d inscription rend un input text :
      # pas de clavier courriel sur mobile, pas de validation native.
      annotations: { inputType: "email" },
      required: { roles: ["user"] },
      permissions: { view: ["admin", "user"], edit: ["admin", "user"] },
      multivalued: false
    },
    {
      name: "firstName",
      displayName: "${firstName}",
      validations: { length: { max: 255 }, "person-name-prohibited-characters": {} },
      permissions: { view: ["admin"], edit: ["admin"] },
      multivalued: false
    },
    {
      name: "lastName",
      displayName: "${lastName}",
      validations: { length: { max: 255 }, "person-name-prohibited-characters": {} },
      permissions: { view: ["admin"], edit: ["admin"] },
      multivalued: false
    }
  ],
  groups: [
    {
      name: "user-metadata",
      displayHeader: "User metadata",
      displayDescription: "Attributes, which refer to user metadata"
    }
  ]
  # Pas de unmanagedAttributePolicy : son absence est deja la politique la
  # plus stricte. L enumeration ne connait que ENABLED, ADMIN_VIEW et
  # ADMIN_EDIT, toute autre valeur fait echouer la desserialisation.
}')"

api PUT "/admin/realms/$REALM/users/profile" "$USER_PROFILE"
expect "200 204"
log "profil applique (email requis, nom et prenom masques)"

# ----------------------------------------------------------------- role player

step "Role realm player"

api GET "/admin/realms/$REALM/roles/player"
if [[ "$HTTP_CODE" != "200" ]]; then
  api POST "/admin/realms/$REALM/roles" \
    '{"name":"player","description":"Joueur OdyssAI"}'
  expect "201"
  log "role cree"
  api GET "/admin/realms/$REALM/roles/player"
  expect "200"
else
  log "role deja present"
fi
PLAYER_ROLE="$RESP_BODY"

api GET "/admin/realms/$REALM/roles/default-roles-$REALM"
expect "200"
DEFAULT_ROLE_ID="$(jq -re '.id' <<<"$RESP_BODY")"

api GET "/admin/realms/$REALM/roles-by-id/$DEFAULT_ROLE_ID/composites"
expect "200"

if ! jq -e 'any(.[]; .name == "player")' <<<"$RESP_BODY" >/dev/null; then
  api POST "/admin/realms/$REALM/roles-by-id/$DEFAULT_ROLE_ID/composites" \
    "$(jq -n --argjson r "$PLAYER_ROLE" '[$r]')"
  expect "204"
  log "role ajoute aux roles par defaut"
else
  log "role deja dans les roles par defaut"
fi

# ---------------------------------------------------------------------- client

step "Client $API_CLIENT_ID"

# Chaque URI reste exacte, sans caractere joker : un joker rendrait le client
# complice de toute redirection sous le domaine.
REDIRECT_URIS="$(jq -n \
  --arg main "$API_BASE_URL/auth/callback" \
  --arg extra "$EXTRA_REDIRECT_URIS" '
    [$main] + ($extra | split(",") | map(select(length > 0)))
    | unique')"
log "redirect_uri : $(jq -r 'join(", ")' <<<"$REDIRECT_URIS")"

CLIENT_CONFIG="$(jq -n \
  --arg id "$API_CLIENT_ID" \
  --argjson redirect "$REDIRECT_URIS" \
  --arg web "$WEB_BASE_URL" '{
  clientId: $id,
  name: "OdyssAI API",
  enabled: true,
  protocol: "openid-connect",

  # Client confidentiel : le secret ne quitte jamais apps/api.
  publicClient: false,
  standardFlowEnabled: true,

  # Tout le reste est coupe. Notamment le direct grant, qui ferait transiter
  # les mots de passe par l API et que OAuth 2.1 retire.
  directAccessGrantsEnabled: false,
  implicitFlowEnabled: false,
  serviceAccountsEnabled: false,

  redirectUris: $redirect,
  webOrigins: [],
  rootUrl: "",
  baseUrl: "",

  frontchannelLogout: false,
  attributes: {
    # PKCE obligatoire meme sur un client confidentiel : defense en profondeur
    # exigee par OAuth 2.1, elle bloque l interception du code d autorisation.
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": ($web + "/##" + $web),
    "backchannel.logout.session.required": "true",
    "client.use.lightweight.access.token.enabled": "false",
    "access.token.lifespan": "300"
  }
}')"

api GET "/admin/realms/$REALM/clients?clientId=$API_CLIENT_ID"
expect "200"
# Pas de -e ici : jq sort en 4 quand le filtre ne produit rien, ce qui tuerait
# le script alors que "client absent" est un cas nominal.
CLIENT_UUID="$(jq -r '.[0].id // empty' <<<"$RESP_BODY")"

if [[ -n "$CLIENT_UUID" ]]; then
  api PUT "/admin/realms/$REALM/clients/$CLIENT_UUID" "$CLIENT_CONFIG"
  expect "204"
  log "client mis a jour"
else
  api POST "/admin/realms/$REALM/clients" "$CLIENT_CONFIG"
  expect "201"
  api GET "/admin/realms/$REALM/clients?clientId=$API_CLIENT_ID"
  expect "200"
  CLIENT_UUID="$(jq -re '.[0].id' <<<"$RESP_BODY")"
  log "client cree"
fi

# Sans ce mapper, l access token ne porte pas odyssai-api dans aud et la
# verification d audience cote API rejette tous les jetons.
api GET "/admin/realms/$REALM/clients/$CLIENT_UUID/protocol-mappers/models"
expect "200"
if ! jq -e 'any(.[]; .name == "odyssai-api-audience")' <<<"$RESP_BODY" >/dev/null; then
  api POST "/admin/realms/$REALM/clients/$CLIENT_UUID/protocol-mappers/models" \
    "$(jq -n --arg id "$API_CLIENT_ID" '{
      name: "odyssai-api-audience",
      protocol: "openid-connect",
      protocolMapper: "oidc-audience-mapper",
      config: {
        "included.client.audience": $id,
        "id.token.claim": "false",
        "access.token.claim": "true",
        "introspection.token.claim": "true"
      }
    }')"
  expect "201"
  log "mapper d audience cree"
else
  log "mapper d audience deja present"
fi

# --------------------------------------------------------------------- secrets

step "Configuration a reporter dans apps/api/.env"

api GET "/admin/realms/$REALM/clients/$CLIENT_UUID/client-secret"
expect "200"
CLIENT_SECRET="$(jq -re '.value' <<<"$RESP_BODY")"

cat <<EOF

KEYCLOAK_ISSUER=$KC_URL/realms/$REALM
KEYCLOAK_CLIENT_ID=$API_CLIENT_ID
KEYCLOAK_CLIENT_SECRET=$CLIENT_SECRET
API_BASE_URL=$API_BASE_URL
WEB_BASE_URL=$WEB_BASE_URL

EOF
