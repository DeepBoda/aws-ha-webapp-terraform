output "app_url" {
  description = "HTTPS URL of the application."
  value       = "https://${var.domain_name}"
}

output "alb_dns_name" {
  description = "Load balancer DNS name (point a CNAME here if you manage DNS outside Route 53)."
  value       = module.alb.dns_name
}

output "name_servers" {
  description = "Add these as NS records for domain_name at the parent domain's DNS provider."
  value       = module.certificate.name_servers
}

output "certificate_validation_records" {
  description = "Only needed when create_dns_zone = false: add these CNAMEs at your DNS provider."
  value       = module.certificate.validation_records
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "asg_name" {
  value = module.compute.asg_name
}

output "app_bucket" {
  description = "Application storage bucket. Release bundles go under releases/."
  value       = module.storage.app_bucket
}

output "alb_logs_bucket" {
  value = module.storage.alb_logs_bucket
}

output "db_endpoint" {
  description = "RDS endpoint, reachable only from the application subnets."
  value       = module.database.address
}

output "db_secret_arn" {
  description = "Secrets Manager secret holding the database credentials (managed and rotated by RDS)."
  value       = module.database.master_secret_arn
}

output "app_version_parameter" {
  description = "SSM parameter the instances read to pick the release to run."
  value       = module.compute.app_version_param
}
