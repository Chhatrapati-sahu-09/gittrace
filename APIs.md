# GitTrace — API Directory

This document lists all external APIs and registries utilized by the **GitTrace** backend to retrieve repository details, scan package dependencies, detect AI-generated code, and identify phantom packages.

---

## Setup & Configuration (Adding API Keys)

To run the GitTrace backend successfully, you must configure the necessary API keys in your environment variables. 

Create a `.env` file inside the `backend` directory (i.e. [backend/.env](file:///c:/Users/Sahu%20Ji/OneDrive/Desktop/REACT%20PROJECTS/gittrace/backend/.env)) and add the following keys:

```env
# 1. GitHub Personal Access Token (PAT)
# Required to authenticate API calls and prevent rate limiting.
# Generate one at: https://github.com/settings/tokens (classic) or https://github.com/settings/personal-access-tokens (fine-grained)
# Required Scopes: "public_repo" (or "repo" if analyzing private repositories)
GITHUB_TOKEN=your_github_personal_access_token_here

# 2. Sapling AI Detection API Key
# Required to calculate the AI probability scores of repository code files.
# Sign up and get a key at: https://sapling.ai
# Set to "demo-mode" to run in sandbox/demo mode with mock/simulated results.
AI_API_KEY=your_sapling_api_key_here
```

---

## 1. GitHub REST API

Used to interact with the repository under analysis and fetch all necessary code and metadata.

- **Base URL:** `https://api.github.com`
- **Authentication:** Bearer Token via the `GITHUB_TOKEN` environment variable.
- **Request Headers:**
  - `Authorization: Bearer <GITHUB_TOKEN>`
  - `Accept: application/vnd.github.v3+json`
  - `User-Agent: GitTrace-Extension/0.1.0`

### Endpoints Used:

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| **GET** | `/repos/{owner}/{repo}` | Fetch repository metadata (stars, forks, language, license metadata, branch name). |
| **GET** | `/repos/{owner}/{repo}/git/trees/{branch}?recursive=1` | Retrieve the repository's recursive file structure in a single request. |
| **GET** | `/repos/{owner}/{repo}/contents/{filePath}` | Fetch content of specific files (e.g., source code and dependency config files). Decoded from base64. |
| **GET** | `/repos/{owner}/{repo}/commits` | Fetch recent commit history (used for commit velocity analysis). |
| **GET** | `/repos/{owner}/{repo}/license` | Access the license file itself to retrieve its SPDX identifier and content details. |

---

## 2. Sapling AI Detection API

Used to scan source files to calculate the probability of the code being AI-generated.

- **Endpoint URL:** `https://api.sapling.ai/api/v1/aidetect` (configured via `AI_API_URL` environment variable)
- **Authentication:** API Key inside the request payload body.
- **Method:** `POST`
- **Request Headers:**
  - `Content-Type: application/json`

### Request Payload:
```json
{
  "key": "<AI_API_KEY>",
  "text": "const express = require('express');\nconst router = express.Router();..."
}
```

### Response Payload:
```json
{
  "score": 0.87
}
```
*Note: The score is returned as a float between `0.0` (human-written) and `1.0` (AI-generated). GitTrace multiplies this by 100 to map it to a `0-100%` range.*

---

## 3. Google OSV (Open Source Vulnerabilities) API

Used to scan project dependency packages for known CVEs (Common Vulnerabilities and Exposures).

- **Ecosystems Checked:** `npm` (package.json), `PyPI` (requirements.txt), `Go` (go.mod), `crates.io` (Cargo.toml), `RubyGems` (Gemfile).
- **Endpoint URL:** `https://api.osv.dev/v1/query`
- **Authentication:** Free public API. No authentication required.
- **Method:** `POST`
- **Request Headers:**
  - `Content-Type: application/json`

### Request Payload:
```json
{
  "package": {
    "name": "postcss",
    "ecosystem": "npm"
  },
  "version": "8.4.20"
}
```

### Response Payload:
```json
{
  "vulns": [
    {
      "id": "GHSA-7fh5-849p-3px3",
      "summary": "PostCSS line return parsing vulnerability",
      "details": "...",
      "published": "2023-04-18T22:27:14Z",
      "severity": [
        {
          "type": "CVSS_V3",
          "score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N"
        }
      ]
    }
  ]
}
```

---

## 4. npm Registry API

Used to check package existence on the public npm registry to detect typosquatting supply chain attacks and AI dependency hallucinations.

- **Base URL:** `https://registry.npmjs.org`
- **Authentication:** Free public API. No authentication required.
- **Method:** `GET`

### Endpoint Path:
- `/` + `{packageName}` (scoped packages like `@org/pkg` are encoded as `@org%2Fpkg`)

### Returns:
- **`200 OK`**: Package exists (metadata is returned to verify details like latest version, authors).
- **`404 Not Found`**: Package does not exist (flagged as a **Phantom Package** risk).

---

## 5. PyPI Registry API

Used to check Python package existence on the public Python Package Index to prevent package name hallucinations.

- **Base URL:** `https://pypi.org/pypi`
- **Authentication:** Free public API. No authentication required.
- **Method:** `GET`

### Endpoint Path:
- `/{packageName}/json`

### Returns:
- **`200 OK`**: Package exists.
- **`404 Not Found`**: Package does not exist (flagged as a **Phantom Package** risk).
