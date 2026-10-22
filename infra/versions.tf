terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State lives in the bucket created by ../bootstrap. Values come from backend.hcl
  # (terraform init -backend-config=backend.hcl), so no account details sit in the code.
  # use_lockfile gives S3-native state locking, no DynamoDB table needed.
  backend "s3" {
    key          = "webapp/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
