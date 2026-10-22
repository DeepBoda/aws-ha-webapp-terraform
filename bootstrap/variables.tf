variable "project" {
  description = "Name prefix. Must match the main stack's project variable."
  type        = string
  default     = "webapp"
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "github_repo" {
  description = "owner/name of the GitHub repository allowed to deploy."
  type        = string
}
