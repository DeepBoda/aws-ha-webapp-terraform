variable "project" {
  description = "Name prefix for every resource."
  type        = string
  default     = "webapp"
}

variable "environment" {
  description = "Environment name, used in tags and names."
  type        = string
  default     = "prod"
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "How many Availability Zones to spread subnets across (2 or 3)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "Use 2 or 3 Availability Zones for high availability."
  }
}

variable "nat_gateway_per_az" {
  description = "One NAT Gateway per AZ (fully zonal, higher cost) instead of a single shared one."
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Hostname the app is served on, for example app.example.com."
  type        = string
}

variable "create_dns_zone" {
  description = "Create a Route 53 hosted zone for domain_name. Delegate it from the parent domain with the name_servers output, then everything else (certificate validation, alias record) is automatic."
  type        = bool
  default     = true
}

variable "app_port" {
  description = "Port the application listens on inside the instances."
  type        = number
  default     = 8080
}

variable "instance_type" {
  description = "EC2 instance type for the application tier."
  type        = string
  default     = "t3.micro"
}

variable "asg_min_size" {
  description = "Minimum number of application instances."
  type        = number
  default     = 2
}

variable "asg_max_size" {
  description = "Maximum number of application instances."
  type        = number
  default     = 4
}

variable "asg_desired_capacity" {
  description = "Desired number of application instances."
  type        = number
  default     = 2
}

variable "cpu_target_percent" {
  description = "Average CPU the Auto Scaling target-tracking policy aims for."
  type        = number
  default     = 50
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "db_engine_version" {
  description = "MySQL engine version."
  type        = string
  default     = "8.0"
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "appdb"
}

variable "db_username" {
  description = "Master username. The password is generated and stored by RDS in Secrets Manager."
  type        = string
  default     = "appadmin"
}

variable "db_allocated_storage" {
  description = "RDS storage in GiB."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Run RDS as Multi-AZ (standby in a second AZ). Recommended for production."
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Protect the database from deletion. Turn off before terraform destroy."
  type        = bool
  default     = false
}

variable "alb_log_retention_days" {
  description = "Days to keep ALB access logs in S3."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Email for CloudWatch alarm notifications. Empty disables the subscription."
  type        = string
  default     = ""
}
