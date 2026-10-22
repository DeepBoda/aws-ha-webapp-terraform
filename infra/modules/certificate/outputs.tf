output "certificate_arn" {
  description = "Validated certificate ARN (depends on validation finishing)."
  value       = aws_acm_certificate_validation.this.certificate_arn
}

output "zone_id" {
  value = var.create_zone ? aws_route53_zone.this[0].zone_id : null
}

output "name_servers" {
  value = var.create_zone ? aws_route53_zone.this[0].name_servers : []
}

output "validation_records" {
  value = [
    for o in aws_acm_certificate.this.domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ]
}
