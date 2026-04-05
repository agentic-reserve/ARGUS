#!/bin/bash
#
# ARGUS Supabase Deployment Script
# 
# Deploys Supabase self-hosted with Docker Compose and libcrux security
# 
# Usage: ./deploy-supabase.sh [docker|kubernetes]
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_MODE="${1:-docker}"

# ==================== Helper Functions ====================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ==================== Pre-flight Checks ====================

check_dependencies() {
    log_info "Checking dependencies..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    log_success "All dependencies found"
}

check_env_file() {
    log_info "Checking environment configuration..."
    
    local env_file="${PROJECT_ROOT}/.env"
    local env_example="${PROJECT_ROOT}/.env.example"
    
    if [[ ! -f "$env_file" ]]; then
        if [[ -f "$env_example" ]]; then
            log_warn ".env file not found. Creating from .env.example"
            cp "$env_example" "$env_file"
            log_warn "Please edit .env with your actual configuration values"
            exit 1
        else
            log_error "No .env or .env.example file found"
            exit 1
        fi
    fi
    
    # Check required variables
    source "$env_file"
    
    if [[ -z "$POSTGRES_PASSWORD" ]] || [[ "$POSTGRES_PASSWORD" == "your-secure-postgres-password-here" ]]; then
        log_error "POSTGRES_PASSWORD not set in .env"
        exit 1
    fi
    
    if [[ -z "$JWT_SECRET" ]] || [[ "$JWT_SECRET" == "your-jwt-secret-key-here" ]]; then
        log_error "JWT_SECRET not set in .env"
        exit 1
    fi
    
    log_success "Environment configuration valid"
}

# ==================== Secret Generation ====================

generate_secrets() {
    log_info "Generating secrets..."
    
    local env_file="${PROJECT_ROOT}/.env"
    local secrets_dir="${PROJECT_ROOT}/secrets"
    
    mkdir -p "$secrets_dir"
    
    # Generate JWT secret if not set
    if ! grep -q "^JWT_SECRET=" "$env_file" || grep -q "^JWT_SECRET=your-jwt-secret-key-here" "$env_file"; then
        local jwt_secret=$(openssl rand -hex 32)
        sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=$jwt_secret/" "$env_file"
        log_success "Generated JWT_SECRET"
    fi
    
    # Generate postgres password if not set
    if ! grep -q "^POSTGRES_PASSWORD=" "$env_file" || grep -q "^POSTGRES_PASSWORD=your-secure-postgres-password-here" "$env_file"; then
        local pg_password=$(openssl rand -base64 32)
        sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$pg_password/" "$env_file"
        log_success "Generated POSTGRES_PASSWORD"
    fi
    
    # Generate libcrux key
    local libcrux_key=$(openssl rand -hex 64)
    echo "$libcrux_key" > "${secrets_dir}/libcrux_key.txt"
    log_success "Generated libcrux encryption key"
    
    # Clean up backup file
    rm -f "${env_file}.bak"
}

# ==================== Docker Deployment ====================

deploy_docker() {
    log_info "Starting Docker deployment..."
    
    local compose_file="${PROJECT_ROOT}/supabase-deployment/docker/docker-compose.yml"
    local env_file="${PROJECT_ROOT}/.env"
    
    if [[ ! -f "$compose_file" ]]; then
        log_error "Docker Compose file not found: $compose_file"
        exit 1
    fi
    
    log_info "Pulling latest images..."
    docker-compose -f "$compose_file" --env-file "$env_file" pull
    
    log_info "Starting services..."
    docker-compose -f "$compose_file" --env-file "$env_file" up -d
    
    log_info "Waiting for services to be healthy..."
    sleep 10
    
    # Check health
    if docker-compose -f "$compose_file" ps | grep -q "healthy"; then
        log_success "Services are healthy"
    else
        log_warn "Some services may still be starting. Check with: docker-compose -f $compose_file ps"
    fi
    
    log_success "Docker deployment complete!"
    log_info "Services available at:"
    log_info "  - Supabase Studio: http://localhost:3000"
    log_info "  - PostgreSQL: localhost:5432"
    log_info "  - Kong API Gateway: http://localhost:8000"
}

# ==================== Kubernetes Deployment ====================

deploy_kubernetes() {
    log_info "Starting Kubernetes deployment..."
    
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi
    
    if ! command -v helm &> /dev/null; then
        log_error "Helm is not installed"
        exit 1
    fi
    
    local k8s_dir="${PROJECT_ROOT}/supabase-deployment/kubernetes"
    
    log_info "Creating namespace..."
    kubectl create namespace supabase --dry-run=client -o yaml | kubectl apply -f -
    
    log_info "Installing with Helm..."
    helm upgrade --install supabase "$k8s_dir" \
        --namespace supabase \
        --values "${k8s_dir}/values-production.yaml" \
        --wait
    
    log_success "Kubernetes deployment complete!"
    log_info "Check status with: kubectl get pods -n supabase"
}

# ==================== Health Checks ====================

health_check() {
    log_info "Running health checks..."
    
    local compose_file="${PROJECT_ROOT}/supabase-deployment/docker/docker-compose.yml"
    local env_file="${PROJECT_ROOT}/.env"
    
    # Check Kong
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        log_success "Kong API Gateway: healthy"
    else
        log_warn "Kong API Gateway: not responding"
    fi
    
    # Check PostgreSQL
    if docker-compose -f "$compose_file" exec -T db pg_isready -U postgres > /dev/null 2>&1; then
        log_success "PostgreSQL: healthy"
    else
        log_warn "PostgreSQL: not responding"
    fi
    
    log_info "Health check complete"
}

# ==================== Cleanup ====================

cleanup() {
    log_info "Cleaning up resources..."
    
    local compose_file="${PROJECT_ROOT}/supabase-deployment/docker/docker-compose.yml"
    
    if [[ -f "$compose_file" ]]; then
        docker-compose -f "$compose_file" down
        log_success "Stopped Docker services"
    fi
}

# ==================== Main ====================

show_help() {
    cat << EOF
ARGUS Supabase Deployment Script

Usage: $0 [COMMAND] [OPTIONS]

Commands:
  docker       Deploy with Docker Compose (default)
  kubernetes   Deploy with Kubernetes/Helm
  health       Run health checks
  cleanup      Stop and remove all resources
  help         Show this help message

Examples:
  $0 docker              # Deploy with Docker
  $0 kubernetes          # Deploy with Kubernetes
  $0 health              # Check service health
  $0 cleanup             # Remove all resources

EOF
}

main() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║     ARGUS Supabase Deployment Script                   ║"
    echo "║     Self-hosted with libcrux Security                  ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    case "${DEPLOY_MODE}" in
        docker)
            check_dependencies
            check_env_file
            generate_secrets
            deploy_docker
            health_check
            ;;
        kubernetes|k8s)
            check_dependencies
            check_env_file
            generate_secrets
            deploy_kubernetes
            ;;
        health)
            health_check
            ;;
        cleanup|down|stop)
            cleanup
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $DEPLOY_MODE"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
