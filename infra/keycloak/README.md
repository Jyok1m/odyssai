# Keycloak

Un realm par environnement sur `sso.joachimjasmin.com`. `apps/api` en est le seul client, confidentiel, et porte le flot Authorization Code + PKCE.

## Configurer un realm

`setup-realm.sh` fait tout par l'Admin REST API et rien par la console. Il est idempotent : le relancer met le realm à jour.

```bash
KC_ADMIN_PASSWORD='...' ./infra/keycloak/setup-realm.sh odyssai-dev

KC_ADMIN_PASSWORD='...' \
API_BASE_URL=https://api.ton-domaine \
WEB_BASE_URL=https://ton-domaine \
  ./infra/keycloak/setup-realm.sh odyssai-prod
```

Il imprime en fin de course les variables à reporter dans `.env`, dont `KEYCLOAK_CLIENT_SECRET`.

Ce qu'il pose : inscription et connexion servies par Keycloak, email comme identifiant, profil utilisateur réduit à l'email, politique de mot de passe à 12 caractères, protection anti brute force, rotation stricte du refresh token, rôle realm `player` par défaut, et un mapper d'audience sans lequel la vérification `aud` côté API rejetterait tous les jetons.

Le client n'autorise que le flot Authorization Code, avec PKCE S256 obligatoire et une `redirect_uri` exacte. Direct grant, implicit et service account sont désactivés.

Variables reconnues : `KC_URL`, `KC_ADMIN_REALM`, `KC_ADMIN_USER`, `KC_ADMIN_PASSWORD`, `API_BASE_URL`, `WEB_BASE_URL`, `API_CLIENT_ID`, `LOGIN_THEME`, `SSL_REQUIRED`.

`SSL_REQUIRED` vaut `all`. Si le proxy devant Keycloak ne transmet pas `X-Forwarded-Proto`, tu boucleras en redirection : relance alors avec `SSL_REQUIRED=external` et corrige le proxy (`KC_PROXY_HEADERS=xforwarded` côté Keycloak).

## Déployer le thème

Le thème `themes/odyssai` doit être en place **avant** de l'activer sur le realm, sinon Keycloak retombe silencieusement sur son thème par défaut.

1. Copier `infra/keycloak/themes/odyssai` dans `/opt/keycloak/themes/` du serveur, ou monter le dossier en volume :

   ```yaml
   volumes:
     - ./themes:/opt/keycloak/themes:ro
   ```

2. Redémarrer Keycloak. En mode `start`, les thèmes sont mis en cache et une modification n'est pas reprise à chaud.

3. Activer le thème sur le realm :

   ```bash
   KC_ADMIN_PASSWORD='...' LOGIN_THEME=odyssai ./infra/keycloak/setup-realm.sh odyssai-dev
   ```

Le thème hérite de `base` et ne surcharge que `template.ftl` et `login.ftl`. Toutes les autres pages (inscription, mot de passe oublié, OTP, erreurs) prennent la même mise en forme par les classes `kc*Class` déclarées dans `theme.properties` : elles n'ont pas à être réécrites, et une montée de version de Keycloak ne les casse pas.

Les couleurs et l'échelle typographique de `resources/css/odyssai.css` sont reprises de `apps/web/src/app/globals.css`. Keycloak ne compile pas Tailwind, elles y sont donc redéclarées en variables CSS : toute évolution du kit doit être reportée dans ce fichier.

## Vérifier localement

```bash
docker run -d --name odyssai-kc-test -p 8081:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  -v "$(pwd)/infra/keycloak/themes:/opt/keycloak/themes:ro" \
  quay.io/keycloak/keycloak:latest start-dev

KC_URL=http://localhost:8081 KC_ADMIN_PASSWORD=admin \
LOGIN_THEME=odyssai SSL_REQUIRED=external \
  ./infra/keycloak/setup-realm.sh odyssai-dev
```

En `start-dev` le cache de thème est désactivé : les modifications de `.ftl` et de CSS sont reprises au rechargement de la page.

## SMTP

`verifyEmail` reste à `false` : sans SMTP configuré sur le realm, un compte non vérifié ne pourrait plus jamais terminer de connexion. Configure le SMTP, puis passe le drapeau. La réinitialisation de mot de passe a la même dépendance, même si le lien est déjà présent sur la page de connexion.
