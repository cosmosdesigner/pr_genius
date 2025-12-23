# Azure DevOps PR Strategy + CLI Automation (Enterprise-Grade)

## A) PR Strategy (Governance)

### Branching Strategy

We recommend a **GitFlow-inspired** approach with simplified branches:

1. **main** - Production-ready code, protected by policies
2. **develop** (optional) - Integration branch for features
3. **feature/ticket-short-desc** - Feature development branches
4. **hotfix/ticket-short-desc** - Critical fixes to production

### Pull Request Workflow

1. Create feature branches from `develop` or `main` (if no develop branch)
2. Develop and test locally
3. Create PR targeting `develop` (for features) or `main` (for hotfixes)
4. Automated checks run (build, lint, unit tests)
5. Required reviewers approve
6. Auto-complete merges when all conditions are met
7. Source branch automatically deleted

### Merge Strategy Recommendation: **Squash**

- **Why**: Maintains clean, linear history on main branches
- **Trade-off**: Loses individual commit context, but PR description preserves context
- **Alternative**: Use "merge_commit" for teams needing detailed commit history

## B) Required Policies

### Branch Policies (configured in ADO UI or via REST API)

1. **Require a minimum number of reviewers**: 2
2. **Require review from Code Owners**: Auto-assign based on file paths
3. **Restrict push to this branch**: Prevent direct pushes
4. **Require build to pass**: Link to build pipeline
5. **Require comment resolution**: All discussion threads must be resolved
6. **Limit merge types**: Enforce selected merge strategy
7. **Require work item linking**: PR must be linked to at least one work item

### Auto-Complete Rules

- **Enabled**: When all policies are satisfied
- **Conditions**:
  - All required reviewers approved
  - Build validation passed
  - Work items linked
  - No active policy conflicts

## C) CLI Setup

### Prerequisites

```bash
# Install Azure CLI
# Windows: Download from https://learn.microsoft.com/en-us/cli/azure/install-azure-cli
# Linux/macOS:
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

### Install Azure DevOps Extension

```bash
az extension add --name azure-devops
```

### Windows PowerShell Setup

```powershell
# Interactive login (default)
az login

# OR PAT-based login (for CI/automation)
$env:AZURE_DEVOPS_EXT_PAT = "<PAT>"
az devops login --organization https://dev.azure.com/<ORG>/

# Configure defaults to reduce repeated flags
az devops configure --defaults organization=https://dev.azure.com/<ORG>/ project=<PROJECT>
```

### Linux/macOS Bash Setup

```bash
# Interactive login (default)
az login

# OR PAT-based login (for CI/automation)
export AZURE_DEVOPS_EXT_PAT="<PAT>"
az devops login --organization https://dev.azure.com/<ORG>/

# Configure defaults to reduce repeated flags
az devops configure --defaults organization=https://dev.azure.com/<ORG>/ project=<PROJECT>
```

## D) Automation Scripts

### Windows PowerShell Script

```powershell
<#
.SYNOPSIS
    Create and manage Azure DevOps Pull Requests with automated reviewer assignment and policy compliance
.DESCRIPTION
    This script creates a PR, adds reviewers, links work items, and configures auto-complete settings
.PARAMETER SourceBranch
    The source branch containing changes
.PARAMETER TargetBranch
    The target branch for the PR (default: main)
.PARAMETER Title
    PR title (if not provided, derived from branch name)
.PARAMETER RequiredReviewers
    Array of required reviewer emails
.PARAMETER OptionalReviewers
    Array of optional reviewer emails
.PARAMETER WorkItems
    Array of work item IDs to link
.PARAMETER AutoComplete
    Enable auto-complete (default: true)
.PARAMETER DeleteSourceBranch
    Delete source branch after merge (default: true)
.PARAMETER UsePat
    Use PAT authentication instead of interactive login
#>

param(
    [Parameter(Mandatory=$true)][string]$SourceBranch,
    [Parameter(Mandatory=$false)][string]$TargetBranch = "main",
    [Parameter(Mandatory=$false)][string]$Title = "",
    [Parameter(Mandatory=$false)][string[]]$RequiredReviewers = @(),
    [Parameter(Mandatory=$false)][string[]]$OptionalReviewers = @(),
    [Parameter(Mandatory=$false)][int[]]$WorkItems = @(),
    [Parameter(Mandatory=$false)][bool]$AutoComplete = $true,
    [Parameter(Mandatory=$false)][bool]$DeleteSourceBranch = $true,
    [Parameter(Mandatory=$false)][switch]$UsePat
)

# Configuration variables - UPDATE THESE
$ORGANIZATION_URL = "https://dev.azure.com/<ORG>/"
$PROJECT = "<PROJECT>"
$REPOSITORY = "<REPO_NAME>"

# Error handling
$ErrorActionPreference = "Stop"

try {
    Write-Host "=== Azure DevOps PR Automation ===" -ForegroundColor Green

    # Authentication
    if ($UsePat) {
        if (-not $env:AZURE_DEVOPS_EXT_PAT) {
            Write-Error "AZURE_DEVOPS_EXT_PAT environment variable not set"
            exit 1
        }
        Write-Host "Authenticating with PAT..." -ForegroundColor Yellow
        az devops login --organization $ORGANIZATION_URL
    } else {
        Write-Host "Using interactive authentication..." -ForegroundColor Yellow
        az login
    }

    # Configure defaults
    Write-Host "Setting default organization and project..." -ForegroundColor Yellow
    az devops configure --defaults organization=$ORGANIZATION_URL project=$PROJECT

    # Generate title if not provided
    if ([string]::IsNullOrEmpty($Title)) {
        # Extract ticket number and description from branch name
        # Example: feature/12345-short-desc becomes "12345: short desc"
        $branchParts = $SourceBranch -split '/'
        $branchName = $branchParts[-1]
        $ticketMatch = [regex]::Match($branchName, '^(\d+)-(.+)$')
        if ($ticketMatch.Success) {
            $Title = "$($ticketMatch.Groups[1]): $($ticketMatch.Groups[2] -replace '-', ' ')"
        } else {
            $Title = "PR from $SourceBranch"
        }
    }

    # Create PR
    Write-Host "Creating PR from $SourceBranch to $TargetBranch..." -ForegroundColor Yellow
    $prResult = az repos pr create `
        --repository $REPOSITORY `
        --source-branch $SourceBranch `
        --target-branch $TargetBranch `
        --title $Title `
        --description "## Changes`n`n## Checklist`n- [ ] Code reviewed`n- [ ] Tests pass`n- [ ] Documentation updated" `
        --merge-strategy squash `
        --output json

    if (-not $prResult) {
        Write-Error "Failed to create PR"
        exit 1
    }

    $prData = $prResult | ConvertFrom-Json
    $prId = $prData.pullRequestId
    Write-Host "Created PR #$prId: $($prData.url)" -ForegroundColor Green

    # Add required reviewers
    if ($RequiredReviewers.Count -gt 0) {
        Write-Host "Adding required reviewers..." -ForegroundColor Yellow
        foreach ($reviewer in $RequiredReviewers) {
            az repos pr reviewer add --id $prId --reviewers $reviewer
            Write-Host "  Added required reviewer: $reviewer" -ForegroundColor Green
        }
    }

    # Add optional reviewers
    if ($OptionalReviewers.Count -gt 0) {
        Write-Host "Adding optional reviewers..." -ForegroundColor Yellow
        foreach ($reviewer in $OptionalReviewers) {
            az repos pr reviewer add --id $prId --reviewers $reviewer --required false
            Write-Host "  Added optional reviewer: $reviewer" -ForegroundColor Green
        }
    }

    # Link work items
    if ($WorkItems.Count -gt 0) {
        Write-Host "Linking work items..." -ForegroundColor Yellow
        foreach ($workItemId in $WorkItems) {
            az repos pr work-item add --id $prId --work-items $workItemId
            Write-Host "  Linked work item: $workItemId" -ForegroundColor Green
        }
    }

    # Configure auto-complete and delete source branch
    if ($AutoComplete -or $DeleteSourceBranch) {
        Write-Host "Configuring PR settings..." -ForegroundColor Yellow
        $updateArgs = @("--id", $prId)

        if ($AutoComplete) {
            $updateArgs += "--auto-complete", "true"
            Write-Host "  Enabled auto-complete" -ForegroundColor Green
        }

        if ($DeleteSourceBranch) {
            $updateArgs += "--delete-source-branch", "true"
            Write-Host "  Enabled source branch deletion" -ForegroundColor Green
        }

        az repos pr update @updateArgs
    }

    # Get final PR details
    Write-Host "Retrieving final PR details..." -ForegroundColor Yellow
    $finalPr = az repos pr show --id $prId --output json | ConvertFrom-Json

    # Output summary
    Write-Host "=== PR Creation Summary ===" -ForegroundColor Cyan
    Write-Host "PR URL: $($finalPr.url)" -ForegroundColor White
    Write-Host "PR ID: #$($finalPr.pullRequestId)" -ForegroundColor White
    Write-Host "Title: $($finalPr.title)" -ForegroundColor White
    Write-Host "Status: $($finalPr.status)" -ForegroundColor White
    Write-Host "Created by: $($finalPr.createdBy.displayName)" -ForegroundColor White
    Write-Host "Created date: $($finalPr.creationDate)" -ForegroundColor White
    Write-Host "Source branch: $($finalPr.sourceRefName)" -ForegroundColor White
    Write-Host "Target branch: $($finalPr.targetRefName)" -ForegroundColor White

    if ($finalPr.reviewers.Count -gt 0) {
        Write-Host "Reviewers:" -ForegroundColor White
        $finalPr.reviewers | ForEach-Object {
            $voteStatus = switch ($_.vote) {
                0 { "No vote" }
                5 { "Approved" }
                10 { "Approved with suggestions" }
                -5 { "Waiting for author" }
                -10 { "Rejected" }
                default { "Unknown" }
            }
            Write-Host "  - $($_.reviewer.displayName): $voteStatus" -ForegroundColor Gray
        }
    }

    Write-Host "PR creation completed successfully!" -ForegroundColor Green

    # Open PR in browser (optional)
    # Start-Process $finalPr.url
} catch {
    Write-Error "Error creating PR: $($_.Exception.Message)"
    exit 1
}
```

### Linux/macOS Bash Script

```bash
#!/bin/bash
#
# Create and manage Azure DevOps Pull Requests with automated reviewer assignment and policy compliance
#
# Usage: ./create-pr.sh -s <source-branch> [options]
#

set -e

# Configuration variables - UPDATE THESE
ORGANIZATION_URL="https://dev.azure.com/<ORG>/"
PROJECT="<PROJECT>"
REPOSITORY="<REPO_NAME>"

# Default values
SOURCE_BRANCH=""
TARGET_BRANCH="main"
TITLE=""
REQUIRED_REVIEWERS=()
OPTIONAL_REVIEWERS=()
WORK_ITEMS=()
AUTO_COMPLETE=true
DELETE_SOURCE_BRANCH=true
USE_PAT=false

# Helper functions
log_info() {
    echo -e "\033[0;33m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1"
}

show_help() {
    cat << EOF
Usage: $0 -s <source-branch> [options]

Required:
  -s, --source-branch   Source branch containing changes

Optional:
  -t, --target-branch   Target branch for PR (default: main)
  --title              PR title (if not provided, derived from branch name)
  --required-reviewers Comma-separated list of required reviewer emails
  --optional-reviewers Comma-separated list of optional reviewer emails
  --work-items         Comma-separated list of work item IDs to link
  --no-auto-complete   Disable auto-complete
  --no-delete-source   Disable source branch deletion after merge
  --use-pat            Use PAT authentication instead of interactive login
  -h, --help           Show this help message

Example:
  $0 -s feature/12345-add-new-api \\
    --required-reviewers "dev1@company.com,dev2@company.com" \\
    --optional-reviewers "pm@company.com" \\
    --work-items "12345,67890"
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--source-branch)
            SOURCE_BRANCH="$2"
            shift 2
            ;;
        -t|--target-branch)
            TARGET_BRANCH="$2"
            shift 2
            ;;
        --title)
            TITLE="$2"
            shift 2
            ;;
        --required-reviewers)
            IFS=',' read -ra REQUIRED_REVIEWERS <<< "$2"
            shift 2
            ;;
        --optional-reviewers)
            IFS=',' read -ra OPTIONAL_REVIEWERS <<< "$2"
            shift 2
            ;;
        --work-items)
            IFS=',' read -ra WORK_ITEMS <<< "$2"
            shift 2
            ;;
        --no-auto-complete)
            AUTO_COMPLETE=false
            shift
            ;;
        --no-delete-source)
            DELETE_SOURCE_BRANCH=false
            shift
            ;;
        --use-pat)
            USE_PAT=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate required arguments
if [[ -z "$SOURCE_BRANCH" ]]; then
    log_error "Source branch is required"
    show_help
    exit 1
fi

# Main script
main() {
    log_info "=== Azure DevOps PR Automation ==="

    # Authentication
    if [[ "$USE_PAT" == "true" ]]; then
        if [[ -z "$AZURE_DEVOPS_EXT_PAT" ]]; then
            log_error "AZURE_DEVOPS_EXT_PAT environment variable not set"
            exit 1
        fi
        log_info "Authenticating with PAT..."
        az devops login --organization "$ORGANIZATION_URL"
    else
        log_info "Using interactive authentication..."
        az login
    fi

    # Configure defaults
    log_info "Setting default organization and project..."
    az devops configure --defaults organization="$ORGANIZATION_URL" project="$PROJECT"

    # Generate title if not provided
    if [[ -z "$TITLE" ]]; then
        # Extract ticket number and description from branch name
        # Example: feature/12345-short-desc becomes "12345: short desc"
        BRANCH_NAME=$(basename "$SOURCE_BRANCH")
        if [[ "$BRANCH_NAME" =~ ^([0-9]+)-(.+)$ ]]; then
            TICKET="${BASH_REMATCH[1]}"
            DESC=$(echo "${BASH_REMATCH[2]}" | tr '-' ' ')
            TITLE="$TICKET: $DESC"
        else
            TITLE="PR from $SOURCE_BRANCH"
        fi
    fi

    # Create PR
    log_info "Creating PR from $SOURCE_BRANCH to $TARGET_BRANCH..."
    PR_RESULT=$(az repos pr create \
        --repository "$REPOSITORY" \
        --source-branch "$SOURCE_BRANCH" \
        --target-branch "$TARGET_BRANCH" \
        --title "$TITLE" \
        --description "## Changes\n\n## Checklist\n- [ ] Code reviewed\n- [ ] Tests pass\n- [ ] Documentation updated" \
        --merge-strategy squash \
        --output json)

    if [[ -z "$PR_RESULT" ]]; then
        log_error "Failed to create PR"
        exit 1
    fi

    PR_ID=$(echo "$PR_RESULT" | jq -r '.pullRequestId')
    PR_URL=$(echo "$PR_RESULT" | jq -r '.url')
    log_success "Created PR #$PR_ID: $PR_URL"

    # Add required reviewers
    if [[ ${#REQUIRED_REVIEWERS[@]} -gt 0 ]]; then
        log_info "Adding required reviewers..."
        for reviewer in "${REQUIRED_REVIEWERS[@]}"; do
            az repos pr reviewer add --id "$PR_ID" --reviewers "$reviewer"
            log_success "  Added required reviewer: $reviewer"
        done
    fi

    # Add optional reviewers
    if [[ ${#OPTIONAL_REVIEWERS[@]} -gt 0 ]]; then
        log_info "Adding optional reviewers..."
        for reviewer in "${OPTIONAL_REVIEWERS[@]}"; do
            az repos pr reviewer add --id "$PR_ID" --reviewers "$reviewer" --required false
            log_success "  Added optional reviewer: $reviewer"
        done
    fi

    # Link work items
    if [[ ${#WORK_ITEMS[@]} -gt 0 ]]; then
        log_info "Linking work items..."
        for workItemId in "${WORK_ITEMS[@]}"; do
            az repos pr work-item add --id "$PR_ID" --work-items "$workItemId"
            log_success "  Linked work item: $workItemId"
        done
    fi

    # Configure auto-complete and delete source branch
    if [[ "$AUTO_COMPLETE" == "true" || "$DELETE_SOURCE_BRANCH" == "true" ]]; then
        log_info "Configuring PR settings..."
        UPDATE_ARGS=("--id" "$PR_ID")

        if [[ "$AUTO_COMPLETE" == "true" ]]; then
            UPDATE_ARGS+=("--auto-complete" "true")
            log_success "  Enabled auto-complete"
        fi

        if [[ "$DELETE_SOURCE_BRANCH" == "true" ]]; then
            UPDATE_ARGS+=("--delete-source-branch" "true")
            log_success "  Enabled source branch deletion"
        fi

        az repos pr update "${UPDATE_ARGS[@]}"
    fi

    # Get final PR details
    log_info "Retrieving final PR details..."
    FINAL_PR=$(az repos pr show --id "$PR_ID" --output json)

    # Output summary
    echo -e "\033[0;36m=== PR Creation Summary ===\033[0m"
    echo -e "\033[0;37mPR URL: $(echo "$FINAL_PR" | jq -r '.url')\033[0m"
    echo -e "\033[0;37mPR ID: #$(echo "$FINAL_PR" | jq -r '.pullRequestId')\033[0m"
    echo -e "\033[0;37mTitle: $(echo "$FINAL_PR" | jq -r '.title')\033[0m"
    echo -e "\033[0;37mStatus: $(echo "$FINAL_PR" | jq -r '.status')\033[0m"
    echo -e "\033[0;37mCreated by: $(echo "$FINAL_PR" | jq -r '.createdBy.displayName')\033[0m"
    echo -e "\033[0;37mCreated date: $(echo "$FINAL_PR" | jq -r '.creationDate')\033[0m"
    echo -e "\033[0;37mSource branch: $(echo "$FINAL_PR" | jq -r '.sourceRefName')\033[0m"
    echo -e "\033[0;37mTarget branch: $(echo "$FINAL_PR" | jq -r '.targetRefName')\033[0m"

    REVIEWER_COUNT=$(echo "$FINAL_PR" | jq '.reviewers | length')
    if [[ $REVIEWER_COUNT -gt 0 ]]; then
        echo -e "\033[0;37mReviewers:\033[0m"
        echo "$FINAL_PR" | jq -r '.reviewers[] | "  - \(.reviewer.displayName): \(if .vote == 0 then "No vote" elif .vote == 5 then "Approved" elif .vote == 10 then "Approved with suggestions" elif .vote == -5 then "Waiting for author" elif .vote == -10 then "Rejected" else "Unknown" end)"' | while read -r line; do
            echo -e "\033[0;90m$line\033[0m"
        done
    fi

    log_success "PR creation completed successfully!"

    # Open PR in browser (optional)
    # if command -v xdg-open &> /dev/null; then
    #     xdg-open "$(echo "$FINAL_PR" | jq -r '.url')"
    # elif command -v open &> /dev/null; then
    #     open "$(echo "$FINAL_PR" | jq -r '.url')"
    # fi
}

# Check for required tools
if ! command -v az &> /dev/null; then
    log_error "Azure CLI is not installed. Please install it first."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    log_error "jq is not installed. Please install it first."
    exit 1
fi

# Run main function
main
```

## E) Validation & Troubleshooting

### Common Issues and Solutions

1. **Authentication Failures**

   ```bash
   # Clear cached credentials
   az account clear
   az logout

   # Re-authenticate
   az login
   ```

2. **Extension Issues**

   ```bash
   # Update Azure DevOps extension
   az extension update --name azure-devops

   # Remove and reinstall if needed
   az extension remove --name azure-devops
   az extension add --name azure-devops
   ```

3. **Permission Errors**

   ```bash
   # Check current user
   az account show

   # Verify project access
   az devops project list
   ```

4. **PR Creation Failures**

   ```bash
   # Check if source branch exists
   az repos ref list --repository <REPO_NAME> --query "[?name=='refs/heads/<SOURCE_BRANCH>']"

   # Check if target branch exists
   az repos ref list --repository <REPO_NAME> --query "[?name=='refs/heads/<TARGET_BRANCH>']"

   # Check for existing PRs
   az repos pr list --repository <REPO_NAME> --source-branch <SOURCE_BRANCH> --target-branch <TARGET_BRANCH>
   ```

5. **Policy Conflicts**

   ```bash
   # Check PR status and policies
   az repos pr show --id <PR_ID> --query "{status: status, mergeStatus: mergeStatus, reviewers: reviewers}"

   # Check policy evaluation
   az repos pr policy list --id <PR_ID>
   ```

### Validation Commands

```bash
# Verify PR creation
az repos pr show --id <PR_ID> --output table

# Check reviewer status
az repos pr reviewer list --id <PR_ID> --output table

# Validate work item links
az repos pr work-item list --id <PR_ID> --output table

# Check merge status
az repos pr show --id <PR_ID> --query "mergeStatus"

# List active PRs
az repos pr list --repository <REPO_NAME> --status active --output table
```

## F) Security Notes

### PAT Management

1. **Generate PATs with minimum required scope:**

   - `Code (Read & Write)` for repository operations
   - `Work Items (Read & Write)` if linking work items
   - `Code (Status)` for build status checks

2. **PAT Lifecycle:**

   - Set expiration dates (recommended: 30-90 days)
   - Rotate PATs regularly
   - Revoke immediately if compromised

3. **Secure Storage:**

   ```bash
   # Linux/macOS - Store in keychain
   echo "<PAT>" | tr -d '\n' | secret-tool store --label='Azure DevOps PAT' azure-devops pat

   # Windows - Store in Credential Manager
   cmdkey /generic:AzureDevOps /user:<username> /pass:<PAT>
   ```

### Authentication Best Practices

1. **Interactive Login** (Recommended for developers):

   - Use `az login` for interactive sessions
   - Leverages MFA and conditional access
   - No need to manage PATs manually

2. **PAT Authentication** (For CI/CD):
   - Use service accounts with limited permissions
   - Store PATs in secure vaults (Azure Key Vault, etc.)
   - Inject as environment variables at runtime

### Least Privilege Principle

1. **Service Accounts:**

   - Create dedicated service accounts for automation
   - Grant only required permissions at project/repository level
   - Use custom security groups for reviewer assignments

2. **Branch Permissions:**
   - Restrict direct pushes to protected branches
   - Use branch policies instead of manual permissions
   - Implement Code Owners for path-based reviews

### Logging and Auditing

1. **Enable diagnostic logging:**

   ```bash
   az monitor diagnostic-settings create --resource <resource-id> --workspace <workspace-id>
   ```

2. **Audit PR activities:**

   ```bash
   # Get PR audit logs
   az repos pr list --repository <REPO_NAME> --query "[].{id: pullRequestId, title: title, createdBy: createdBy.displayName, creationDate: creationDate}"
   ```

3. **Monitor PAT usage:**
   ```bash
   # Check PAT usage statistics
   az devops user list --top 100 --query "[].{name: displayName, lastAccessed: lastAccessedDate}"
   ```

### Environment Variable Security

```bash
# Linux/macOS - Secure environment variable setup
export AZURE_DEVOPS_EXT_PAT=$(secret-tool lookup azure-devops pat)

# Windows PowerShell - Secure environment variable setup
$env:AZURE_DEVOPS_EXT_PAT = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host "Enter PAT" -AsSecureString)))
```

## Conclusion

This comprehensive Azure DevOps PR strategy and CLI automation solution provides:

1. A clear governance model with branch policies and reviewer requirements
2. Cross-platform automation scripts for both PowerShell and bash
3. Secure authentication patterns for both interactive and CI scenarios
4. Robust error handling and troubleshooting guidance
5. Security best practices for PAT management and least privilege access

The scripts are production-ready and can be integrated into CI/CD pipelines or used directly by developers for consistent PR creation and management.
