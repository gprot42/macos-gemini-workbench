#!/bin/bash
# setup-vertex-sa.sh - Create or remove a service account for Vertex AI access
#
# Usage: 
#   ./setup-vertex-sa.sh PROJECT_ID [SERVICE_ACCOUNT_NAME]    # Create
#   ./setup-vertex-sa.sh --remove PROJECT_ID [SERVICE_ACCOUNT_NAME]  # Remove
#
# This script creates a Google Cloud service account with the necessary
# permissions to use Vertex AI with Gemini Workbench.

set -e

# Add common paths for gcloud
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/google-cloud-sdk/bin:$HOME/.local/google-cloud-sdk/bin"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
APP_CONFIG_DIR="$HOME/.gemini-workbench"
KEY_FILE="$APP_CONFIG_DIR/vertex-key.json"
REMOVE_MODE=false
YES_MODE=false
GCLOUD_ACCOUNT=""

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Gemini Workbench - Vertex AI Service Account Setup${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"
}

print_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

show_usage() {
    print_header
    echo "Usage:"
    echo "  $0 [--account ACCOUNT] [--yes] PROJECT_ID [SERVICE_ACCOUNT_NAME]"
    echo "  $0 --remove [--account ACCOUNT] [--yes] PROJECT_ID [SERVICE_ACCOUNT_NAME]"
    echo ""
    echo "Options:"
    echo "  --account ACCOUNT    Google Cloud account to use (e.g., user@domain.com)"
    echo "  --yes, -y            Skip confirmation prompts (for non-interactive use)"
    echo "  --remove             Remove service account, keys, and local key file"
    echo ""
    echo "Arguments:"
    echo "  PROJECT_ID           Your Google Cloud project ID (required)"
    echo "  SERVICE_ACCOUNT_NAME Name for the service account (default: gemini-workbench-vertex)"
    echo ""
    echo "Examples:"
    echo "  $0 --account user@example.com my-project     # Create with specific account"
    echo "  $0 my-gcp-project                            # Create with default account"
    echo "  $0 --yes my-gcp-project                      # Create without prompts"
    echo "  $0 --remove my-gcp-project                   # Remove service account"
    exit 1
}

remove_service_account() {
    local project_id="$1"
    local sa_name="$2"
    local sa_email="${sa_name}@${project_id}.iam.gserviceaccount.com"

    print_header
    echo -e "${RED}  REMOVE MODE${NC}"
    echo ""
    echo -e "Project ID:      ${YELLOW}${project_id}${NC}"
    echo -e "Service Account: ${YELLOW}${sa_name}${NC}"
    echo ""

    # Check if gcloud is installed
    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI is not installed"
        exit 1
    fi
    print_step "gcloud CLI found"

    # Check if authenticated
    echo ""
    echo "Checking authentication..."
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 | grep -q "."; then
        print_error "Not authenticated with gcloud"
        echo ""
        echo "Please run: gcloud auth login"
        exit 1
    fi
    ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
    print_step "Authenticated as: $ACTIVE_ACCOUNT"

    # Set the project
    echo ""
    echo "Setting project..."
    if ! gcloud config set project "$project_id" 2>&1; then
        print_error "Failed to set project: $project_id"
        exit 1
    fi
    print_step "Project set to $project_id"

    # Check if service account exists
    if ! gcloud iam service-accounts describe "$sa_email" &>/dev/null; then
        print_warning "Service account does not exist: $sa_email"
    else
        echo -e "${RED}This will permanently delete:${NC}"
        echo "  - Service account: $sa_email"
        echo "  - All associated keys"
        echo "  - IAM policy bindings"
        echo ""
        if [ "$YES_MODE" = true ]; then
            echo "Auto-confirming (--yes mode)"
            confirm="y"
        else
            read -p "Are you sure you want to continue? (y/N): " confirm
        fi
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            echo "Aborted."
            exit 0
        fi

        echo ""
        echo "Removing IAM policy bindings..."
        
        # Remove IAM bindings
        gcloud projects remove-iam-policy-binding "$project_id" \
            --member="serviceAccount:$sa_email" \
            --role="roles/aiplatform.user" \
            --quiet 2>/dev/null || true
        print_step "Removed: Vertex AI User role"

        gcloud projects remove-iam-policy-binding "$project_id" \
            --member="serviceAccount:$sa_email" \
            --role="roles/aiplatform.modelGardenUser" \
            --quiet 2>/dev/null || true
        print_step "Removed: Model Garden User role"

        echo ""
        echo "Deleting service account..."
        gcloud iam service-accounts delete "$sa_email" --quiet 2>/dev/null
        print_step "Service account deleted: $sa_email"
    fi

    # Remove local key file
    if [ -f "$KEY_FILE" ]; then
        echo ""
        if [ "$YES_MODE" = true ]; then
            echo "Auto-confirming key file deletion (--yes mode)"
            confirm_key="y"
        else
            read -p "Delete local key file ($KEY_FILE)? (y/N): " confirm_key
        fi
        if [[ "$confirm_key" =~ ^[Yy]$ ]]; then
            rm -f "$KEY_FILE"
            rm -f "${KEY_FILE}.bak" 2>/dev/null || true
            print_step "Local key file deleted: $KEY_FILE"
        fi
    else
        print_warning "Key file not found at $KEY_FILE"
    fi

    echo ""
    echo -e "${GREEN}Cleanup complete!${NC}"
    echo ""
}

create_service_account() {
    local project_id="$1"
    local sa_name="$2"
    local sa_email="${sa_name}@${project_id}.iam.gserviceaccount.com"

    print_header

    echo -e "Project ID:      ${YELLOW}${project_id}${NC}"
    echo -e "Service Account: ${YELLOW}${sa_name}${NC}"
    echo -e "Key File:        ${YELLOW}${KEY_FILE}${NC}"
    echo ""

    # Check if gcloud is installed
    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI is not installed"
        echo "Please install it from: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi

    print_step "gcloud CLI found"

    # Check if authenticated
    echo ""
    echo "Checking authentication..."
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 | grep -q "."; then
        print_error "Not authenticated with gcloud"
        echo ""
        echo "Please run one of the following commands first:"
        echo "  gcloud auth login                    # For user account"
        echo "  gcloud auth application-default login  # For application credentials"
        echo ""
        exit 1
    fi
    ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
    print_step "Authenticated as: $ACTIVE_ACCOUNT"

    # Set the project
    echo ""
    echo "Setting project..."
    if ! gcloud config set project "$project_id" 2>&1; then
        print_error "Failed to set project: $project_id"
        echo ""
        echo "Possible causes:"
        echo "  - Project does not exist"
        echo "  - You don't have access to the project"
        echo "  - Project ID is misspelled"
        echo ""
        echo "To verify, run: gcloud projects describe $project_id"
        exit 1
    fi
    
    # Verify project access
    echo "Verifying project access..."
    if ! gcloud projects describe "$project_id" --format="value(projectId)" 2>/dev/null | grep -q "."; then
        print_error "Cannot access project: $project_id"
        echo ""
        echo "Make sure:"
        echo "  - The project ID is correct (not project name)"
        echo "  - You have at least 'Viewer' access to the project"
        echo "  - The project exists and is not deleted"
        echo ""
        exit 1
    fi
    print_step "Project set to $project_id"

    # Enable required APIs
    echo ""
    echo "Enabling required APIs..."
    gcloud services enable aiplatform.googleapis.com --quiet 2>/dev/null || true
    gcloud services enable compute.googleapis.com --quiet 2>/dev/null || true
    print_step "Vertex AI API enabled"

    # Check if service account already exists
    echo ""
    echo "Checking for existing service account..."
    if gcloud iam service-accounts describe "$sa_email" &>/dev/null; then
        print_warning "Service account already exists: $sa_email"
        if [ "$YES_MODE" = true ]; then
            echo "Auto-confirming key recreation (--yes mode)"
            confirm="y"
        else
            read -p "Delete existing keys and create new one? (y/N): " confirm
        fi
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            # Delete existing keys
            for key in $(gcloud iam service-accounts keys list --iam-account="$sa_email" --format="value(name)" --filter="keyType=USER_MANAGED" 2>/dev/null); do
                gcloud iam service-accounts keys delete "$key" --iam-account="$sa_email" --quiet 2>/dev/null || true
            done
            print_step "Existing keys deleted"
        else
            echo "Aborting."
            exit 0
        fi
    else
        # Create service account
        echo "Creating service account..."
        gcloud iam service-accounts create "$sa_name" \
            --display-name="Gemini Workbench Vertex AI" \
            --description="Service account for Gemini Workbench to access Vertex AI" \
            2>/dev/null
        print_step "Service account created: $sa_email"
    fi

    # Grant required roles
    echo ""
    echo "Granting IAM roles..."

    # Vertex AI User
    gcloud projects add-iam-policy-binding "$project_id" \
        --member="serviceAccount:$sa_email" \
        --role="roles/aiplatform.user" \
        --quiet 2>/dev/null || true
    print_step "Granted: Vertex AI User (roles/aiplatform.user)"

    # Model Garden User (for Claude models via Anthropic)
    gcloud projects add-iam-policy-binding "$project_id" \
        --member="serviceAccount:$sa_email" \
        --role="roles/aiplatform.modelGardenUser" \
        --quiet 2>/dev/null || true
    print_step "Granted: Model Garden User (roles/aiplatform.modelGardenUser)"

    # Create key file in ~/.gemini-workbench/
    echo ""
    echo "Creating key file..."
    
    # Ensure directory exists
    mkdir -p "$APP_CONFIG_DIR"
    chmod 700 "$APP_CONFIG_DIR"
    
    if [ -f "$KEY_FILE" ]; then
        print_warning "Key file already exists, backing up to ${KEY_FILE}.bak"
        mv "$KEY_FILE" "${KEY_FILE}.bak"
    fi

    gcloud iam service-accounts keys create "$KEY_FILE" \
        --iam-account="$sa_email" \
        2>/dev/null
    print_step "Key file created: $KEY_FILE"

    # Set permissions on key file
    chmod 600 "$KEY_FILE"
    print_step "Key file permissions set (600)"

    # Print summary
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Setup Complete!${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}Project ID:${NC}"
    echo "  $project_id"
    echo ""
    echo -e "${YELLOW}Service Account:${NC}"
    echo "  $sa_email"
    echo ""
    echo -e "${YELLOW}Key File:${NC}"
    echo "  $KEY_FILE"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${GREEN}Gemini Workbench will automatically detect the key file!${NC}"
    echo ""
    echo "To use in Gemini Workbench:"
    echo "  1. Open Settings (Menu → Settings)"
    echo "  2. Enter '$project_id' as 'Project ID'"
    echo "  3. Select 'Vertex AI' as the endpoint"
    echo "  4. Leave 'API Key' empty - auto-refresh is enabled!"
    echo ""
    echo "The app automatically uses: $KEY_FILE"
    echo "Tokens are refreshed automatically - no manual refresh needed!"
    echo ""
    echo "To remove this service account:"
    echo "  $0 --remove $project_id $sa_name"
    echo ""
    echo -e "${RED}IMPORTANT:${NC} Keep $KEY_FILE secure!"
    echo ""

    # Add to .gitignore if not already there
    if [ -f ".gitignore" ]; then
        if ! grep -q "vertex-key.json" .gitignore; then
            echo "vertex-key.json" >> .gitignore
            print_step "Added $KEY_FILE to .gitignore"
        fi
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --remove)
            REMOVE_MODE=true
            shift
            ;;
        --yes|-y)
            YES_MODE=true
            shift
            ;;
        --account)
            GCLOUD_ACCOUNT="$2"
            shift 2
            ;;
        -*)
            print_error "Unknown option: $1"
            show_usage
            ;;
        *)
            break
            ;;
    esac
done

if [ -z "$1" ]; then
    show_usage
fi

PROJECT_ID="$1"
SA_NAME="${2:-gemini-workbench-vertex}"

# Set account if specified
if [ -n "$GCLOUD_ACCOUNT" ]; then
    echo "Using account: $GCLOUD_ACCOUNT"
    gcloud config set account "$GCLOUD_ACCOUNT" 2>/dev/null
fi

if [ "$REMOVE_MODE" = true ]; then
    remove_service_account "$PROJECT_ID" "$SA_NAME"
else
    create_service_account "$PROJECT_ID" "$SA_NAME"
fi
