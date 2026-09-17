pipeline {
    agent any

    environment {
        DOCKER_NS  = 'jyok1m'
        WEB_IMAGE  = "${DOCKER_NS}/odyssai-web"
        API_IMAGE  = "${DOCKER_NS}/odyssai-api"
        DOCKER_TAG = "${env.BRANCH_NAME}"
        SSH_HOST = "host.docker.internal"

        // Les images sont publiées pour amd64. Sur un agent arm, docker a
        // besoin de binfmt/QEMU pour cette plateforme.
        PLATFORM = 'linux/amd64'

        // SITE_URL est consommée pendant le prerender de Next : /fr et /en
        // sont statiques, donc canonical, OpenGraph, sitemap et JSON-LD sont
        // figés au build. L'image est donc liée à son environnement.
        SITE_URL = "${env.BRANCH_NAME == 'main' ? 'https://odyssai.app' : 'https://dev.odyssai.app'}"

        // Même contrainte pour l'origine de l'API : le navigateur l'appelle
        // pour la connexion et la lecture de session, et la valeur est
        // inscrite dans le bundle au build. Elle doit partager le domaine
        // enregistrable du site, sinon le cookie de session (SameSite=Lax)
        // ne part pas : api.odyssai.app avec odyssai.app, api-dev avec dev.
        // Les deux noms viennent du rôle Ansible odyssai. `api-dev` et non
        // `api.dev` : le joker DNS *.odyssai.app ne couvre qu'un seul label,
        // la forme pointée ne résoudrait nulle part et sortirait du
        // certificat d'edge.
        NEXT_PUBLIC_API_BASE_URL = "${env.BRANCH_NAME == 'main' ? 'https://api.odyssai.app' : 'https://api-dev.odyssai.app'}"

        // Cle publique du widget Turnstile, elle aussi figee dans le bundle au
        // build. Un widget Cloudflare ne vaut que pour les hostnames qu'il
        // declare : celui de odyssai.app refuse un jeton emis sur
        // dev.odyssai.app, d'ou un widget par copie.
        NEXT_PUBLIC_TURNSTILE_SITE_KEY = "${env.BRANCH_NAME == 'main' ? '0xPROD_SITE_KEY' : '0xDEV_SITE_KEY'}"
    }

    stages {
        stage('Build') {
            when {
                anyOf {
                    branch 'dev'
                    branch 'main'
                }
            }
            parallel {
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
            }
        }

        stage('Publish') {
            when {
                anyOf {
                    branch 'dev'
                    branch 'main'
                }
            }
            // Les deux push restent séquentiels : ils partagent la même
            // session docker login, et un logout concurrent ferait échouer
            // le push de l'autre.
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
                SERVICES = "${env.BRANCH_NAME == 'main' ? 'api web' : 'api-dev web-dev'}"
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
                            docker compose -f /opt/odyssai/docker-compose.yml pull $SERVICES && \
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
            '''
        }
    }
}
