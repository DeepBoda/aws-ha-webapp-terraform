#!/usr/bin/env bash
# quick look at the live stack, reads names from terraform output
set -uo pipefail
cd "$(dirname "$0")/../infra"

url=$(terraform output -raw app_url)
asg=$(terraform output -raw asg_name)
logs=$(terraform output -raw alb_logs_bucket)
domain=${url#https://}

echo "== http goes to https"
curl -sI "http://$domain" | grep -iE "^HTTP|^location"

echo
echo "== health"
curl -s "$url/health"; echo
curl -s "$url/health/db"; echo

echo
echo "== 10 requests, which az answered"
for i in $(seq 1 10); do curl -s "$url/api/info" | jq -r '.instance.az'; done | sort | uniq -c

echo
echo "== alb targets"
tg=$(aws elbv2 describe-target-groups --query "TargetGroups[?starts_with(TargetGroupName,'webapp-prod')].TargetGroupArn | [0]" --output text)
aws elbv2 describe-target-health --target-group-arn "$tg" \
  --query "TargetHealthDescriptions[].[Target.Id,TargetHealth.State]" --output text

echo
echo "== auto scaling group"
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$asg" \
  --query "AutoScalingGroups[0].[MinSize,DesiredCapacity,MaxSize]" --output text | awk '{print "min "$1"  desired "$2"  max "$3}'
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$asg" \
  --query "AutoScalingGroups[0].Instances[].[InstanceId,AvailabilityZone,LifecycleState,HealthStatus]" --output text

echo
echo "== rds"
aws rds describe-db-instances --query "DBInstances[?starts_with(DBInstanceIdentifier,'webapp-prod')].[DBInstanceIdentifier,Engine,EngineVersion,DBInstanceStatus,StorageEncrypted]" --output text

echo
echo "== cloudwatch alarms"
aws cloudwatch describe-alarms --alarm-name-prefix webapp-prod --query "MetricAlarms[].[AlarmName,StateValue]" --output text

echo
echo "== alb access logs in s3"
echo "$(aws s3 ls "s3://$logs/alb/" --recursive | wc -l | tr -d ' ') log files"
