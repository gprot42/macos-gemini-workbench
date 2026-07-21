# AI Studio API Key Setup

This guide explains how to set up an API key for using Google AI Studio with Gemini Workbench.

## Authentication Methods

| Method                           | Expires   | Vertex AI | AI Studio | Setup Complexity |
|----------------------------------|-----------|-----------|-----------|------------------|
| AI Studio API Key                | ❌ Never  | ❌ No     | ✅ Yes    | Simple           |
| Service Account (auto-refresh)   | ❌ Never* | ✅ Yes    | ❌ No     | One-time setup   |
| Access Token (manual)            | ⏱️ 1 hour | ✅ Yes    | ❌ No     | Manual refresh   |

*The service account key file doesn't expire; access tokens are refreshed automatically.

**Recommendation:**
- For **AI Studio** models (Gemini) → Use an **API Key** (this guide)
- For **Vertex AI** models (Claude, Gemini) → Use a [Service Account](vertex-ai-setup.md)

## Quick Setup

### Step 1: Get Your API Key

1. Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **Create API Key**
4. Copy the generated key

### Step 2: Configure Gemini Workbench

1. Open Gemini Workbench
2. Click **Menu** → **Settings**
3. In the **API Key** field, paste your API key
4. Select **AI Studio** as the endpoint
5. Click **Save Settings**

That's it! You can now use AI Studio models.

## Available Models on AI Studio

| Model | Description |
|-------|-------------|
| Gemini 3.1 Pro | Advanced multimodal reasoning |
| Gemini 3.1 Flash Lite | Fast and efficient |
| Gemini 3.5 Flash | Agentic & coding model |
| Gemini 3.6 Flash | Latest Flash for agentic workflows & coding |
| Gemini Deep Research | Multi-step web research agent |

> **Note:** Claude models are only available through Vertex AI, not AI Studio.

## API Key vs Vertex AI

| Feature | AI Studio | Vertex AI |
|---------|-----------|-----------|
| Claude models | ❌ | ✅ |
| Gemini models | ✅ | ✅ |
| Free tier | ✅ (limited) | ❌ |
| Enterprise features | ❌ | ✅ |
| Data residency | ❌ | ✅ |
| VPC-SC support | ❌ | ✅ |

## Troubleshooting

### "Invalid API key" error

- Ensure you copied the full API key
- Check that you selected **AI Studio** as the endpoint, not Vertex AI
- Try creating a new API key

### "Quota exceeded" error

AI Studio has usage limits. Options:
- Wait for quota to reset (daily)
- Switch to Vertex AI for higher limits

## Security Best Practices

1. **Don't share your API key** - Keep it confidential
2. **Regenerate if compromised** - Create a new key and delete the old one
3. **Use project-specific keys** - Create separate keys for different applications

## Revoking an API Key

1. Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. Find the key you want to revoke
3. Click the **Delete** icon
4. Confirm deletion
