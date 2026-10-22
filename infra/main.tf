locals {
  name = "${var.project}-${var.environment}"
}

data "aws_availability_zones" "available" {
  state = "available"
}

module "network" {
  source = "./modules/network"

  name               = local.name
  vpc_cidr           = var.vpc_cidr
  azs                = slice(data.aws_availability_zones.available.names, 0, var.az_count)
  nat_gateway_per_az = var.nat_gateway_per_az
}

module "security" {
  source = "./modules/security"

  name     = local.name
  vpc_id   = module.network.vpc_id
  app_port = var.app_port
}

module "storage" {
  source = "./modules/storage"

  name                   = local.name
  alb_log_retention_days = var.alb_log_retention_days
}

module "database" {
  source = "./modules/database"

  name                  = local.name
  subnet_ids            = module.network.database_subnet_ids
  security_group_id     = module.security.db_sg_id
  instance_class        = var.db_instance_class
  engine_version        = var.db_engine_version
  db_name               = var.db_name
  username              = var.db_username
  allocated_storage     = var.db_allocated_storage
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  deletion_protection   = var.db_deletion_protection
}

module "certificate" {
  source = "./modules/certificate"

  domain_name = var.domain_name
  create_zone = var.create_dns_zone
}

module "alb" {
  source = "./modules/alb"

  name              = local.name
  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.public_subnet_ids
  security_group_id = module.security.alb_sg_id
  certificate_arn   = module.certificate.certificate_arn
  app_port          = var.app_port
  log_bucket        = module.storage.alb_logs_bucket
}

module "compute" {
  source = "./modules/compute"

  name               = local.name
  region             = var.region
  subnet_ids         = module.network.private_app_subnet_ids
  security_group_id  = module.security.app_sg_id
  target_group_arn   = module.alb.target_group_arn
  instance_type      = var.instance_type
  app_port           = var.app_port
  min_size           = var.asg_min_size
  max_size           = var.asg_max_size
  desired_capacity   = var.asg_desired_capacity
  cpu_target_percent = var.cpu_target_percent
  app_bucket         = module.storage.app_bucket
  app_bucket_arn     = module.storage.app_bucket_arn
  db_secret_arn      = module.database.master_secret_arn
  db_host            = module.database.address
  db_name            = var.db_name
  app_version_param  = "/${local.name}/app/version"
}

# Public name for the app: an alias record in the delegated zone.
resource "aws_route53_record" "app" {
  count = var.create_dns_zone ? 1 : 0

  zone_id = module.certificate.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.alb.dns_name
    zone_id                = module.alb.zone_id
    evaluate_target_health = true
  }
}

module "monitoring" {
  source = "./modules/monitoring"

  name           = local.name
  alarm_email    = var.alarm_email
  alb_arn_suffix = module.alb.arn_suffix
  tg_arn_suffix  = module.alb.target_group_arn_suffix
  db_instance_id = module.database.instance_id
}
