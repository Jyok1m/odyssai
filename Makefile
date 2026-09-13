# Raccourcis du monorepo. Rien d'indispensable ici : tout reste faisable a la
# main avec pnpm et les scripts de infra/. Ce fichier evite surtout de retaper
# les invocations longues et de se tromper de realm.
#
# Les recettes tournent chacune dans son propre shell, d'ou les && et les \
# plutot que des lignes successives quand une etape depend de la precedente.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Secrets et coordonnees du serveur. Ignore par git, voir .env.local.example.
ENV_LOCAL := .env.local

# Realm vise par les cibles realm-*. Surchargeable :
#   make realm REALM=odyssai-prod
REALM ?= odyssai-dev

# Le fichier est source par le shell et non `include`e par make. Make traite #
# comme un debut de commentaire et developpe lui-meme les $, ce qui mutile
# silencieusement un secret qui en contient. set -a exporte tout ce qui est
# defini entre les deux, sans avoir a lister les variables une par une.
REQUIRE_ENV = if [ ! -f $(ENV_LOCAL) ]; then \
		echo "$(ENV_LOCAL) est absent. Le creer a partir de .env.local.example." >&2; \
		exit 1; \
	fi
# set -e en plus de set -a : une ligne mal formee dans le fichier (typiquement
# une valeur contenant une espace et non quotee) est executee comme une
# commande par le shell. Sans -e, elle echoue en affichant une erreur et le
# chargement continue avec une variable tronquee, ce qui se voit beaucoup plus
# tard et beaucoup moins bien.
LOAD_ENV = set -ae && . ./$(ENV_LOCAL) && set +ae

.PHONY: help install dev build lint typecheck check realm realm-prod tunnel redis-ping

help: ## Liste les cibles
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Installe les dependances du workspace
	pnpm install

dev: ## Lance web (3000) et api (3001) en watch
	pnpm dev

build: ## Construit tous les paquets
	pnpm build

lint: ## Lint tous les paquets
	pnpm lint

typecheck: ## Verifie les types partout
	pnpm typecheck

check: typecheck lint build ## Le passage complet avant de commiter

# Le script est idempotent : le rejouer met le realm a jour sans le recreer.
#
# Deux facons de s'authentifier, et setup-realm.sh les distingue par les noms
# de variables. KC_SA_KIND dit laquelle KC_SA_* designe :
#
#   user   (defaut) un compte du realm d'administration, par direct grant.
#   client un service account, soit l'identifiant d'un client confidentiel et
#          son secret.
#
# Le defaut est `user` parce que le compte en place n'existe pas comme client
# dans master. Un service account reste preferable le jour ou il sera cree : il
# est insensible au MFA, que le direct grant ne sait pas presenter.
realm: ## Configure le realm Keycloak (REALM=odyssai-dev par defaut)
	@$(REQUIRE_ENV); $(LOAD_ENV); \
	if [ -z "$$KC_SA_USERNAME" ] || [ -z "$$KC_SA_PASSWORD" ]; then \
		echo "KC_SA_USERNAME et KC_SA_PASSWORD doivent etre renseignes dans $(ENV_LOCAL)." >&2; \
		exit 1; \
	fi; \
	if [ "$${KC_SA_KIND:-user}" = "client" ]; then \
		KC_ADMIN_CLIENT_ID="$$KC_SA_USERNAME" \
		KC_ADMIN_CLIENT_SECRET="$$KC_SA_PASSWORD" \
		./infra/keycloak/setup-realm.sh $(REALM); \
	else \
		KC_ADMIN_USER="$$KC_SA_USERNAME" \
		KC_ADMIN_PASSWORD="$$KC_SA_PASSWORD" \
		./infra/keycloak/setup-realm.sh $(REALM); \
	fi

# Le realm de production vise les origines deployees : sans ces deux variables
# le script retombe sur localhost et inscrit une redirect_uri inutilisable.
realm-prod: ## Configure odyssai-prod avec les origines deployees
	$(MAKE) realm REALM=odyssai-prod \
		API_BASE_URL=https://api.odyssai.app \
		WEB_BASE_URL=https://odyssai.app

# -N n'ouvre aucun shell distant, le processus ne sert qu'a porter la
# redirection. Il reste au premier plan : Ctrl+C ferme donc vraiment le tunnel,
# ce qu'un tunnel tenu par une application tierce ne fait pas.
#
# Le serveur ne publie le Redis de dev que sur sa boucle locale, d'ou le
# 127.0.0.1 cote distant.
tunnel: ## Ouvre le tunnel SSH vers le Redis de dev
	@$(REQUIRE_ENV); $(LOAD_ENV); \
	if [ -z "$$SSH_HOST" ]; then \
		echo "SSH_HOST doit etre renseigne dans $(ENV_LOCAL)." >&2; \
		exit 1; \
	fi; \
	if [ -n "$$SSH_KEY_FILE" ]; then key=(-i "$$SSH_KEY_FILE"); else key=(); fi; \
	echo "Tunnel vers $$SSH_HOST, port local $${REDIS_LOCAL_PORT:-16379}. Ctrl+C pour fermer."; \
	ssh -N "$${key[@]}" \
		-p "$${SSH_PORT:-22}" \
		-o ExitOnForwardFailure=yes \
		-o ServerAliveInterval=30 \
		-L "$${REDIS_LOCAL_PORT:-16379}:127.0.0.1:$${REDIS_REMOTE_PORT:-6379}" \
		"debian@$$SSH_HOST"

# Un port qui accepte la connexion ne prouve rien : un client SSH garde le port
# lie meme quand la session derriere est tombee. Seul un PING tranche. On teste
# REDIS_URL du .env, celle-la meme que l'api utilise, et pas une reconstruite.
redis-ping: ## Verifie que le tunnel Redis repond vraiment
	@node -e "process.loadEnvFile('.env'); \
		const {Redis} = require('ioredis'); \
		const r = new Redis(process.env.REDIS_URL, {maxRetriesPerRequest: 1, lazyConnect: true}); \
		r.connect().then(() => r.ping()) \
		 .then(p => { console.log('Redis ->', p); return r.quit(); }) \
		 .catch(e => { console.error('Redis KO ->', e.message); r.disconnect(); process.exit(1); });"
