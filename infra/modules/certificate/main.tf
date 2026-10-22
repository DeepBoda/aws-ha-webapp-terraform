# ACM certificate for the app hostname, validated over DNS.
# create_zone = true: Terraform owns a Route 53 zone for the hostname and writes the
# validation records itself. The parent domain only needs NS records pointing here.
# create_zone = false: add the validation_records output at your DNS provider by hand.

resource "aws_route53_zone" "this" {
  count = var.create_zone ? 1 : 0
  name  = var.domain_name
}

resource "aws_acm_certificate" "this" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = var.create_zone ? {
    for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => o
  } : {}

  zone_id         = aws_route53_zone.this[0].zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

# Waits until ACM sees the records, so the HTTPS listener never gets a pending certificate.
resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = var.create_zone ? [for r in aws_route53_record.validation : r.fqdn] : null

  timeouts {
    create = "60m"
  }
}
