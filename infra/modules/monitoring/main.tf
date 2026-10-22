# A small alarm set that covers the user-facing path: errors, unhealthy targets, latency,
# and the database running out of CPU or disk. Alarms go to one SNS topic.

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    alb-5xx = {
      namespace  = "AWS/ApplicationELB"
      metric     = "HTTPCode_Target_5XX_Count"
      stat       = "Sum"
      threshold  = 10
      comparison = "GreaterThanThreshold"
      dimensions = { LoadBalancer = var.alb_arn_suffix }
      about      = "More than 10 target 5xx responses in 5 minutes"
    }
    unhealthy-targets = {
      namespace  = "AWS/ApplicationELB"
      metric     = "UnHealthyHostCount"
      stat       = "Maximum"
      threshold  = 0
      comparison = "GreaterThanThreshold"
      dimensions = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.tg_arn_suffix }
      about      = "At least one target failing health checks"
    }
    latency = {
      namespace  = "AWS/ApplicationELB"
      metric     = "TargetResponseTime"
      stat       = "Average"
      threshold  = 1
      comparison = "GreaterThanThreshold"
      dimensions = { LoadBalancer = var.alb_arn_suffix }
      about      = "Average response time above 1 second"
    }
    db-cpu = {
      namespace  = "AWS/RDS"
      metric     = "CPUUtilization"
      stat       = "Average"
      threshold  = 80
      comparison = "GreaterThanThreshold"
      dimensions = { DBInstanceIdentifier = var.db_instance_id }
      about      = "Database CPU above 80%"
    }
    db-storage = {
      namespace  = "AWS/RDS"
      metric     = "FreeStorageSpace"
      stat       = "Minimum"
      threshold  = 2147483648
      comparison = "LessThanThreshold"
      dimensions = { DBInstanceIdentifier = var.db_instance_id }
      about      = "Less than 2 GiB of database storage left"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each = local.alarms

  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.about
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = each.value.dimensions
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
