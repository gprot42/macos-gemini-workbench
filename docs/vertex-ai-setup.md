# Vertex AI Service Account Setup

This guide explains how to set up a Google Cloud service account for using Vertex AI with Gemini Workbench.

## Authentication Methods

Gemini Workbench supports multiple authentication methods depending on which endpoint you use:

| Method                           | Expires    | Vertex AI | AI Studio | Setup Complexity |
|----------------------------------|------------|-----------|-----------|------------------|
| AI Studio API Key                | ❌ Never   | ❌ No     | ✅ Yes    | Simple           |
| Service Account (auto-refresh)   | ❌ Never*  | ✅ Yes    | ❌ No     | One-time setup   |
| Access Token (manual)            | ⏱️ 1 hour  | ✅ Yes    | ❌ No     | Manual refresh   |

*The service account key file doesn't expire; access tokens are refreshed automatically.

**Recommendation:**
- For **AI Studio** models (Gemini) → Use an [AI Studio API Key](ai-studio-setup.md) (simplest)
- For **Vertex AI** models (Claude, Gemini) → Use a **Service Account** (this guide)

## Prerequisites

- A Google Cloud account with billing enabled
- The `gcloud` CLI installed ([Install Guide](https://cloud.google.com/sdk/docs/install))
- A Google Cloud project with Vertex AI API enabled

## Quick Setup (Automated)

Run the provided script to automatically create a service account:

```bash
./scripts/setup-vertex-sa.sh YOUR_PROJECT_ID
```

This will:
1. Create a service account named `gemini-workbench-vertex`
2. Grant the required Vertex AI permissions
3. Save the JSON key file to `~/.gemini-workbench/vertex-key.json`
4. The app will automatically detect and use the key!

## Manual Setup

### Step 1: Set Your Project

```bash
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID
```

### Step 2: Enable Required APIs

```bash
gcloud services enable aiplatform.googleapis.com
gcloud services enable compute.googleapis.com
```

### Step 3: Create Service Account

```bash
gcloud iam service-accounts create gemini-workbench-vertex \
    --display-name="Gemini Workbench Vertex AI" \
    --description="Service account for Gemini Workbench to access Vertex AI"
```

### Step 4: Grant Permissions

```bash
# Grant Vertex AI User role
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:gemini-workbench-vertex@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"

# Grant Model Garden User role (for Claude models)
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:gemini-workbench-vertex@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/aiplatform.modelGardenUser"
```

### Step 5: Create and Download Key

```bash
gcloud iam service-accounts keys create ~/.gemini-workbench/vertex-key.json \
    --iam-account=gemini-workbench-vertex@${PROJECT_ID}.iam.gserviceaccount.com

# Set secure permissions
chmod 600 ~/.gemini-workbench/vertex-key.json
```

## Using in Gemini Workbench

Once the key file is saved to `~/.gemini-workbench/vertex-key.json`, the app will **automatically detect it**.

1. Open Gemini Workbench
2. Click **Menu** → **Settings**
3. In the **Project ID** field, enter your Google Cloud project ID
4. Select **Vertex AI** as the endpoint
5. Leave **API Key** empty - auto-refresh is enabled!

> **Note:** Tokens are refreshed automatically. No manual token management needed!

## How Auto-Refresh Works

The app automatically:
1. Detects the key file at `~/.gemini-workbench/vertex-key.json`
2. Generates a JWT signed with the service account private key
3. Exchanges it for an access token with Google's OAuth server
4. Caches the token and refreshes it before expiry (every ~55 minutes)

## Available Models on Vertex AI

| Model | Description |
|-------|-------------|
| Claude 4.5 Haiku | Fast and efficient |
| Claude 4.6 Sonnet | Balanced performance with 1M context |
| Claude 4.8 Opus | Most capable flagship model |
| Gemini 3.1 Pro | Advanced multimodal reasoning |
| Gemini 3.1 Flash Lite | Low-latency high-volume tasks |
| Gemini 3.5 Flash | Agentic & coding at Flash speed |
| Gemini 3.6 Flash | Latest Flash for agentic workflows & coding |

## Troubleshooting

### "Permission denied" errors

Ensure the service account has the correct roles:

```bash
gcloud projects get-iam-policy $PROJECT_ID \
    --flatten="bindings[].members" \
    --format="table(bindings.role)" \
    --filter="bindings.members:gemini-workbench-vertex"
```

### "API not enabled" errors

Enable the Vertex AI API:

```bash
gcloud services enable aiplatform.googleapis.com
```

### Token expired

Regenerate the access token:

```bash
gcloud auth print-access-token
```

## Security Best Practices

1. **Rotate keys regularly** - Delete old keys and create new ones monthly
2. **Use least privilege** - Only grant the roles needed
3. **Protect key files** - Never commit key files to version control
4. **Monitor usage** - Check Cloud Console for unexpected API calls

## Cleanup

### Automated Cleanup

Use the setup script with the `--remove` flag:

```bash
./scripts/setup-vertex-sa.sh --remove YOUR_PROJECT_ID
```

This will:
1. Delete the service account
2. Remove IAM policy bindings
3. Optionally delete the local key file

### Manual Cleanup

To manually remove the service account:

```bash
gcloud iam service-accounts delete \
    gemini-workbench-vertex@${PROJECT_ID}.iam.gserviceaccount.com
```
