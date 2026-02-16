terraform {
  required_version = ">= 1.5.0"
  required_providers {
    osc = {
      source  = "registry.terraform.io/EyevinnOSC/osc"
      version = ">= 0.3.0"
    }
  }
}

############################
# Variables
############################

variable "osc_pat" {
  type        = string
  sensitive   = true
  description = "Eyevinn OSC Personal Access Token"
}

variable "osc_environment" {
  type        = string
  default     = "prod"
  description = "OSC Environment"
}

variable "intercom_name" {
  type        = string
  default     = "intercom2"
  description = "Name prefix for all resources. Lowercase letters and numbers only"
}

variable "github_url" {
  type        = string
  default     = "https://github.com/borisasadanin/intercom-manager"
  description = "GitHub repository URL for the Intercom Manager fork"
}

variable "github_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "GitHub personal access token (only needed for private repos)"
}

variable "smb_api_key" {
  type        = string
  default     = null
  sensitive   = true
  description = "Symphony Media Bridge API key. Leave empty to auto-generate"
}

variable "db_admin_password" {
  type        = string
  default     = null
  sensitive   = true
  description = "CouchDB admin password. Leave empty to auto-generate"
}

variable "db_name" {
  type        = string
  default     = "intercom"
  description = "Name of the CouchDB database"
}

variable "jwt_secret" {
  type        = string
  default     = null
  sensitive   = true
  description = "JWT signing secret. Leave empty to auto-generate"
}

############################
# Locals
############################

locals {
  smb_api_key_final       = var.smb_api_key != null ? var.smb_api_key : random_password.smb_api_key.result
  db_admin_password_final = var.db_admin_password != null ? var.db_admin_password : random_password.db_admin_password.result
  jwt_secret_final        = var.jwt_secret != null ? var.jwt_secret : random_password.jwt_secret.result
  couchdb_base_host       = trimprefix(osc_apache_couchdb.this.instance_url, "https://")
  db_connection_string    = "https://admin:${local.db_admin_password_final}@${local.couchdb_base_host}/${var.db_name}"
}

############################
# Provider
############################

provider "osc" {
  pat         = var.osc_pat
  environment = var.osc_environment
}

############################
# Random passwords
############################

resource "random_password" "smb_api_key" {
  length  = 16
  special = false
}

resource "random_password" "db_admin_password" {
  length  = 16
  special = false
}

resource "random_password" "jwt_secret" {
  length  = 32
  special = false
}

############################
# Secrets
############################

resource "osc_secret" "smb_api_key" {
  service_ids  = ["eyevinn-docker-wrtc-sfu"]
  secret_name  = "${var.intercom_name}smbapikey"
  secret_value = local.smb_api_key_final

  lifecycle {
    create_before_destroy = true
  }
}

############################
# Resource: Symphony Media Bridge (SFU)
############################

resource "osc_eyevinn_docker_wrtc_sfu" "this" {
  name    = var.intercom_name
  api_key = format("{{secrets.%s}}", osc_secret.smb_api_key.secret_name)
}

############################
# Resource: CouchDB
############################

resource "osc_apache_couchdb" "this" {
  name           = "${var.intercom_name}db"
  admin_password = local.db_admin_password_final
}

# Wait for CouchDB to be ready, then create database
resource "null_resource" "wait_for_couchdb" {
  depends_on = [osc_apache_couchdb.this]

  provisioner "local-exec" {
    command     = "${path.module}/scripts/create-db.sh '${local.db_connection_string}'"
    interpreter = ["/bin/bash", "-c"]
  }
}

############################
# Resource: Valkey (backing App Config Service)
############################

resource "osc_valkey_io_valkey" "this" {
  name = "${var.intercom_name}valkey"
}

############################
# Resource: App Config Service
############################

resource "osc_eyevinn_app_config_svc" "this" {
  name      = "${var.intercom_name}cfg"
  redis_url = "redis://${osc_valkey_io_valkey.this.external_ip}:${osc_valkey_io_valkey.this.external_port}"
}

# Populate config values after config service is ready
resource "null_resource" "populate_config" {
  depends_on = [
    osc_eyevinn_app_config_svc.this,
    osc_eyevinn_docker_wrtc_sfu.this,
    null_resource.wait_for_couchdb
  ]

  provisioner "local-exec" {
    command = "${path.module}/scripts/populate-config.sh"
    environment = {
      CONFIG_URL    = osc_eyevinn_app_config_svc.this.instance_url
      SMB_ADDRESS   = osc_eyevinn_docker_wrtc_sfu.this.instance_url
      SMB_APIKEY    = local.smb_api_key_final
      DB_CONN       = local.db_connection_string
      JWT_SECRET    = local.jwt_secret_final
      PORT          = "8080"
    }
    interpreter = ["/bin/bash", "-c"]
  }
}

############################
# Resource: Web Runner (Intercom Manager)
############################

resource "osc_eyevinn_web_runner" "this" {
  name           = var.intercom_name
  source_url     = var.github_url
  config_service = "${var.intercom_name}cfg"
  git_hub_token  = var.github_token != "" ? var.github_token : null

  depends_on = [null_resource.populate_config]
}

############################
# Outputs
############################

output "intercom_url" {
  value       = osc_eyevinn_web_runner.this.instance_url
  description = "URL to the Intercom application (frontend + backend)"
}

output "smb_url" {
  value       = osc_eyevinn_docker_wrtc_sfu.this.instance_url
  description = "URL to Symphony Media Bridge"
}

output "couchdb_url" {
  value       = osc_apache_couchdb.this.instance_url
  description = "URL to CouchDB"
}

output "config_service_url" {
  value       = osc_eyevinn_app_config_svc.this.instance_url
  description = "URL to App Config Service"
}
