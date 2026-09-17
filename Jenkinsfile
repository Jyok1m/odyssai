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
    }

    stages {
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
