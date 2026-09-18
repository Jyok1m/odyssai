pipeline {
    agent any

    environment {
        DOCKER_NS     = 'jyok1m'
        WEB_IMAGE     = "${DOCKER_NS}/odyssai-web"
        API_IMAGE     = "${DOCKER_NS}/odyssai-api"
        WORKER_IMAGE  = "${DOCKER_NS}/odyssai-worker"
        MIGRATE_IMAGE = "${DOCKER_NS}/odyssai-migrate"
        DOCKER_TAG    = "${env.BRANCH_NAME}"
        SSH_HOST = "host.docker.internal"
        PLATFORM = 'linux/amd64'
        // Static pre-render
        SITE_URL = "${env.BRANCH_NAME == 'main' ? 'https://odyssai.app' : 'https://dev.odyssai.app'}"
        NEXT_PUBLIC_API_BASE_URL = "${env.BRANCH_NAME == 'main' ? 'https://api.odyssai.app' : 'https://api-dev.odyssai.app'}"

        // Cle publique du widget Turnstile
        NEXT_PUBLIC_TURNSTILE_SITE_KEY = "${env.BRANCH_NAME == 'main' ? '0x4AAAAAAE58ZZITd0iT8j5F' : '0x4AAAAAAE59s7cZsoHX1-Ku'}"
        NEXT_PUBLIC_ALPHA_OPEN = "${env.BRANCH_NAME == 'main' ? 'false' : 'true'}"

        // Meme image que les Dockerfiles : tester sur une autre version de node
        // que celle qui sert en production ne prouverait pas grand chose.
        NODE_IMAGE = 'node:24-bookworm-slim'
    }

    stages {
        stage('Test') {
            // Volontairement sans `when` : une branche de travail ne construit
            // aucune image, mais ses tests doivent tourner. C'est le seul
            // retour qu'elle recoit avant sa fusion dans dev.
            //
            // Le conteneur tourne sous l'uid de Jenkins. En root, node_modules
            // et les dist reviendraient a root et le nettoyage du workspace
            // echouerait au build suivant ; corepack s'installe donc dans un
            // HOME pris dans le workspace, seul endroit ou un utilisateur sans
            // droits peut ecrire.
            //
            // Aucun service n'est necessaire : Redis et Prisma sont doubles
            // dans chaque suite, et test/setup-env.ts pose des URL factices.
            stages {
                stage('deps') {
                    steps {
                        sh '''
                            docker run --rm \
                                --platform "$PLATFORM" \
                                -v "$PWD":/app -w /app \
                                -u "$(id -u):$(id -g)" \
                                -e HOME=/app/.ci-home \
                                -e COREPACK_HOME=/app/.ci-home/corepack \
                                -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
                                -e CI=true \
                                "$NODE_IMAGE" \
                                sh -eu -c '
                                    mkdir -p "$HOME/bin"
                                    corepack enable --install-directory "$HOME/bin"
                                    export PATH="$HOME/bin:$PATH"
                                    pnpm install --frozen-lockfile --child-concurrency=1
                                    pnpm exec turbo run build --filter=@odyssai/api^...
                                '
                        '''
                    }
                }

                // Avant les suites, parce que rien d autre ne verifiait les
                // types avant la construction des images. Vitest transpile
                // avec esbuild, qui ne les regarde pas : un objet litteral
                // portant deux fois la meme propriete passait toutes les
                // suites, puis faisait echouer `nest build` six minutes plus
                // tard. C est arrive sur une fusion ou deux branches avaient
                // corrige le meme bug chacune de son cote, chacune dans une
                // zone que git a su fusionner sans conflit.
                stage('types') {
                    steps {
                        sh '''
                            docker run --rm \
                                --platform "$PLATFORM" \
                                -v "$PWD":/app -w /app \
                                -u "$(id -u):$(id -g)" \
                                -e HOME=/app/.ci-home \
                                -e COREPACK_HOME=/app/.ci-home/corepack \
                                -e CI=true \
                                "$NODE_IMAGE" \
                                sh -eu -c '
                                    export PATH="$HOME/bin:$PATH"
                                    pnpm typecheck
                                '
                        '''
                    }
                }

                // Les deux suites sont deux commandes, pas une : `test` ne
                // couvre que l unitaire, les bouts en bout ont leur propre
                // configuration. Une regression qui ne casse que les seconds
                // passerait inapercue, et c est deja arrive. Deux etapes pour
                // que Jenkins dise laquelle a lache.
                //
                // Les conteneurs qui suivent ne reinstallent rien : le
                // workspace est monte, node_modules et les shims corepack y
                // sont deja.
                stage('unit') {
                    steps {
                        sh '''
                            docker run --rm \
                                --platform "$PLATFORM" \
                                -v "$PWD":/app -w /app \
                                -u "$(id -u):$(id -g)" \
                                -e HOME=/app/.ci-home \
                                -e COREPACK_HOME=/app/.ci-home/corepack \
                                -e CI=true \
                                "$NODE_IMAGE" \
                                sh -eu -c '
                                    export PATH="$HOME/bin:$PATH"
                                    pnpm --filter @odyssai/api test
                                '
                        '''
                    }
                }
                stage('e2e') {
                    steps {
                        sh '''
                            docker run --rm \
                                --platform "$PLATFORM" \
                                -v "$PWD":/app -w /app \
                                -u "$(id -u):$(id -g)" \
                                -e HOME=/app/.ci-home \
                                -e COREPACK_HOME=/app/.ci-home/corepack \
                                -e CI=true \
                                "$NODE_IMAGE" \
                                sh -eu -c '
                                    export PATH="$HOME/bin:$PATH"
                                    pnpm --filter @odyssai/api test:e2e
                                '
                        '''
                    }
                }
            }
        }

        stage('Build') {
            when {
                anyOf {
                    branch 'dev'
                    branch 'main'
                }
            }
            // En serie et non en parallele : deux `pnpm install` de cinq cents
            // paquets en meme temps depassent la memoire de la machine, qui
            // porte aussi Postgres, Redis, Keycloak et le reste.
            stages {
                // En premier parce qu'il est le plus court : un schema qui ne
                // compile pas se voit en quinze secondes plutot qu'apres le
                // build du web.
                stage('migrate') {
                    steps {
                        sh '''
                            docker build \
                                --platform "$PLATFORM" \
                                -f packages/db/Dockerfile \
                                -t "$MIGRATE_IMAGE:$DOCKER_TAG" \
                                .
                        '''
                    }
                }
                stage('web') {
                    steps {
                        // Contexte à la racine : le lockfile et
                        // packages/schemas sont hors de apps/web.
                        sh '''
                            docker build \
                                --platform "$PLATFORM" \
                                --build-arg SITE_URL="$SITE_URL" \
                                --build-arg NEXT_PUBLIC_API_BASE_URL="$NEXT_PUBLIC_API_BASE_URL" \
                                --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY="$NEXT_PUBLIC_TURNSTILE_SITE_KEY" \
                                --build-arg NEXT_PUBLIC_ALPHA_OPEN="$NEXT_PUBLIC_ALPHA_OPEN" \
                                -f apps/web/Dockerfile \
                                -t "$WEB_IMAGE:$DOCKER_TAG" \
                                .
                        '''
                    }
                }
                stage('api') {
                    steps {
                        sh '''
                            docker build \
                                --platform "$PLATFORM" \
                                -f apps/api/Dockerfile \
                                -t "$API_IMAGE:$DOCKER_TAG" \
                                .
                        '''
                    }
                }
                stage('worker') {
                    steps {
                        // Aucun build-arg : le worker ne sert aucune page, tout
                        // ce qu'il lit arrive par son fichier d'environnement.
                        sh '''
                            docker build \
                                --platform "$PLATFORM" \
                                -f apps/worker/Dockerfile \
                                -t "$WORKER_IMAGE:$DOCKER_TAG" \
                                .
                        '''
                    }
                }
            }
        }

        stage('Publish') {
            when {
                anyOf {
                    branch 'dev'
                    branch 'main'
                }
            }
            // Les push restent séquentiels : ils partagent la même session
            // docker login, et un logout concurrent ferait échouer celui des
            // autres.
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-credentials',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh '''
                        echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin
                        docker push "$WEB_IMAGE:$DOCKER_TAG"
                        docker push "$API_IMAGE:$DOCKER_TAG"
                        docker push "$WORKER_IMAGE:$DOCKER_TAG"
                        docker push "$MIGRATE_IMAGE:$DOCKER_TAG"
                        docker logout
                    '''
                }
            }
        }

        stage('Deploy') {
            when {
                anyOf {
                    branch 'dev'
                    branch 'main'
                }
            }
            environment {
                // Le worker avant le web : il ne sert rien, donc un
                // redémarrage un peu long ne fait attendre personne.
                SERVICES = "${env.BRANCH_NAME == 'main' ? 'api worker web' : 'api-dev worker-dev web-dev'}"
                // Conteneur jetable, dans le profil `tools` du compose : il ne
                // demarre jamais avec les autres, seulement quand on l'appelle.
                MIGRATE = "${env.BRANCH_NAME == 'main' ? 'migrate' : 'migrate-dev'}"
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'host-ssh-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'host-ssh-port', variable: 'HOST_PORT'),
                    usernamePassword(credentialsId: 'dockerhub-credentials', usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASS')
                ]) {
                    sh '''
                        printf '%s' "$DOCKER_PASS" | ssh -i "$SSH_KEY" -p "$HOST_PORT" \
                            -o StrictHostKeyChecking=no \
                            "$SSH_USER@$SSH_HOST" \
                            "trap 'docker logout >/dev/null 2>&1' EXIT; \
                            docker login -u '$DOCKER_USER' --password-stdin && \
                            docker compose -f /opt/odyssai/docker-compose.yml --profile tools pull $SERVICES $MIGRATE && \
                            docker compose -f /opt/odyssai/docker-compose.yml --profile tools run --rm $MIGRATE && \
                            docker compose -f /opt/odyssai/docker-compose.yml up -d $SERVICES"
                    '''
                }
            }
        }
    }

    post {
        always {
            sh '''
                docker rmi "$WEB_IMAGE:$DOCKER_TAG" || true
                docker rmi "$API_IMAGE:$DOCKER_TAG" || true
                docker rmi "$WORKER_IMAGE:$DOCKER_TAG" || true
                docker rmi "$MIGRATE_IMAGE:$DOCKER_TAG" || true
            '''
        }
    }
}
