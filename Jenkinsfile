pipeline {
    agent any

    environment {
        DOCKER_NS  = 'jyok1m'
        WEB_IMAGE  = "${DOCKER_NS}/odyssai-web"
        API_IMAGE  = "${DOCKER_NS}/odyssai-api"
        DOCKER_TAG = "${env.BRANCH_NAME}"

        // Les images sont publiées pour amd64. Sur un agent arm, docker a
        // besoin de binfmt/QEMU pour cette plateforme.
        PLATFORM = 'linux/amd64'

        // SITE_URL est consommée pendant le prerender de Next : /fr et /en
        // sont statiques, donc canonical, OpenGraph, sitemap et JSON-LD sont
        // figés au build. L'image est donc liée à son environnement.
        // TODO confirmer le domaine de staging.
        SITE_URL = "${env.BRANCH_NAME == 'main' ? 'https://odyssai.app' : 'https://dev.odyssai.app'}"
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
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'host-ssh-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'host-ssh-port', variable: 'HOST_PORT'),
                    usernamePassword(credentialsId: 'dockerhub-credentials', usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASS')
                ]) {
                    sh '''
                        ssh -i "$SSH_KEY" -p "$HOST_PORT" \
                            -o StrictHostKeyChecking=no \
                            "$SSH_USER@$SSH_HOST" \
                            "set -e && \
                            echo '$DOCKER_PASS' | docker login -u '$DOCKER_USER' --password-stdin && \
                            docker compose -f /opt/odyssai/docker-compose.yml pull odyssai && \
                            docker compose -f /opt/odyssai/docker-compose.yml up odyssai -d && \
                            docker logout"
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
