output "asg_name" {
  value = aws_autoscaling_group.app.name
}

output "app_version_param" {
  value = aws_ssm_parameter.app_version.name
}

output "instance_role_name" {
  value = aws_iam_role.app.name
}
