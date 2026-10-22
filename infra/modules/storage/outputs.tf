output "app_bucket" {
  value = aws_s3_bucket.this["app"].id
}

output "app_bucket_arn" {
  value = aws_s3_bucket.this["app"].arn
}

output "alb_logs_bucket" {
  value = aws_s3_bucket.this["logs"].id
}
