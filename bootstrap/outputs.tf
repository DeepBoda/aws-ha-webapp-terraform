output "state_bucket" {
  description = "Put this in infra/backend.hcl and in the TF_STATE_BUCKET repository variable."
  value       = aws_s3_bucket.state.id
}

output "deploy_role_arn" {
  description = "Put this in the AWS_DEPLOY_ROLE_ARN repository variable."
  value       = aws_iam_role.deploy.arn
}
