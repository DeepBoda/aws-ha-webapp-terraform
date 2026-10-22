# Application tier: an Auto Scaling Group of Amazon Linux 2023 instances in the private
# app subnets, behind the ALB. No SSH and no key pair: shell access is SSM Session Manager.
#
# Releases: CI uploads releases/app-<version>.tgz to the app bucket, writes <version> to
# an SSM parameter and starts an instance refresh. Each new instance reads the parameter
# at boot and runs that release. Until the first release exists, instances serve a small
# placeholder that still passes the health check.

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_ssm_parameter" "app_version" {
  name        = var.app_version_param
  description = "Release the application instances run. Written by the app pipeline."
  type        = "String"
  value       = "none"

  # The app pipeline owns this value after the first apply.
  lifecycle {
    ignore_changes = [value]
  }
}

# ---- IAM: only what the app needs ----

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.name}-app-instance"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "ReadDatabaseSecret"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [var.db_secret_arn]
  }

  statement {
    sid       = "ReadReleaseVersion"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.app_version.arn]
  }

  statement {
    sid       = "ReadReleases"
    actions   = ["s3:GetObject"]
    resources = ["${var.app_bucket_arn}/releases/*"]
  }

  statement {
    sid       = "ReadWriteUploads"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${var.app_bucket_arn}/uploads/*"]
  }

  statement {
    sid       = "ListOwnPrefixes"
    actions   = ["s3:ListBucket"]
    resources = [var.app_bucket_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["releases/*", "uploads/*"]
    }
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "${var.name}-app"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.name}-app"
  role = aws_iam_role.app.name
}

# ---- Launch template and Auto Scaling Group ----

resource "aws_launch_template" "app" {
  name_prefix   = "${var.name}-app-"
  image_id      = data.aws_ssm_parameter.al2023.insecure_value
  instance_type = var.instance_type

  vpc_security_group_ids = [var.security_group_id]
  update_default_version = true

  iam_instance_profile {
    arn = aws_iam_instance_profile.app.arn
  }

  # IMDSv2 only.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 10
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  monitoring {
    enabled = true
  }

  user_data = base64encode(templatefile("${path.module}/user_data.sh.tftpl", {
    region        = var.region
    app_port      = var.app_port
    app_bucket    = var.app_bucket
    version_param = aws_ssm_parameter.app_version.name
    db_host       = var.db_host
    db_name       = var.db_name
    db_secret_arn = var.db_secret_arn
  }))

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.name}-app" }
  }

  tag_specifications {
    resource_type = "volume"
    tags          = { Name = "${var.name}-app" }
  }
}

resource "aws_autoscaling_group" "app" {
  name                = "${var.name}-app"
  vpc_zone_identifier = var.subnet_ids
  target_group_arns   = [var.target_group_arn]

  min_size         = var.min_size
  max_size         = var.max_size
  desired_capacity = var.desired_capacity

  health_check_type         = "ELB"
  health_check_grace_period = 240
  default_instance_warmup   = 120

  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }

  # A changed launch template rolls instances one batch at a time, keeping half in service.
  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
    }
  }

  enabled_metrics = ["GroupInServiceInstances", "GroupDesiredCapacity", "GroupTotalInstances"]

  tag {
    key                 = "Name"
    value               = "${var.name}-app"
    propagate_at_launch = true
  }

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}

resource "aws_autoscaling_policy" "cpu" {
  name                   = "${var.name}-cpu-target"
  autoscaling_group_name = aws_autoscaling_group.app.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = var.cpu_target_percent
  }
}
