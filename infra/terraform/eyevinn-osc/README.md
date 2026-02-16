# Intercom 2 -- Eyevinn OSC Deployment

Deploy the complete Intercom 2 system on [Eyevinn Open Source Cloud](https://www.osaas.io) with a single command.

## Components

This Terraform configuration provisions:

| Component | Purpose |
|-----------|---------|
| **Symphony Media Bridge** | WebRTC SFU for low-latency audio |
| **CouchDB** | Database for productions, clients, calls |
| **Valkey** | Backing store for config service |
| **App Config Service** | Environment variable injection |
| **Web Runner** | Runs the Intercom Manager + Frontend |

## Prerequisites

- [Terraform](https://terraform.io) or [OpenTofu](https://opentofu.org) >= 1.6.0
- An [Eyevinn OSC](https://www.osaas.io) account with a Personal Access Token (PAT)

## Quick Start

```bash
# Set your OSC Personal Access Token
export TF_VAR_osc_pat="your-pat-here"

# Initialize and deploy
terraform init
terraform apply
```

## Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `osc_pat` | Yes | -- | OSC Personal Access Token |
| `intercom_name` | No | `intercom2` | Name prefix for all resources |
| `github_url` | No | `https://github.com/borisasadanin/intercom-manager` | GitHub repo URL |
| `github_token` | No | `""` | GitHub PAT (for private repos only) |
| `smb_api_key` | No | auto-generated | SMB API key |
| `db_admin_password` | No | auto-generated | CouchDB admin password |
| `db_name` | No | `intercom` | CouchDB database name |
| `jwt_secret` | No | auto-generated | JWT signing secret |

## Custom Fork

To deploy a different fork:

```bash
terraform apply -var="github_url=https://github.com/your-org/your-fork"
```

## Teardown

```bash
terraform destroy
```

This will remove all provisioned OSC resources.
