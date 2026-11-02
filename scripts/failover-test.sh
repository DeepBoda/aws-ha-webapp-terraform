#!/usr/bin/env bash
# kills one app instance and keeps calling the site every second
# shows the site stays up and the asg brings a new instance back
set -uo pipefail
cd "$(dirname "$0")/../infra"

url=$(terraform output -raw app_url)
asg=$(terraform output -raw asg_name)
tg=$(aws elbv2 describe-target-groups --query "TargetGroups[?starts_with(TargetGroupName,'webapp-prod')].TargetGroupArn | [0]" --output text)

victim=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$asg" \
  --query "AutoScalingGroups[0].Instances[0].InstanceId" --output text)

ok=0; fail=0
echo "$(date +%T) terminating $victim"
aws autoscaling terminate-instance-in-auto-scaling-group \
  --instance-id "$victim" --no-should-decrement-desired-capacity --query "Activity.Description" --output text
start=$(date +%s)

while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url/health")
  if [ "$code" = "200" ]; then ok=$((ok+1)); else fail=$((fail+1)); echo "$(date +%T) got $code"; fi

  healthy=$(aws elbv2 describe-target-health --target-group-arn "$tg" \
    --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy' && Target.Id!='$victim'])" --output text)
  if [ "$healthy" -ge 2 ]; then break; fi
  sleep 1
done

echo "$(date +%T) back to 2 healthy targets after $(( $(date +%s) - start ))s"
echo "requests during the test: $ok ok, $fail failed"
aws elbv2 describe-target-health --target-group-arn "$tg" \
  --query "TargetHealthDescriptions[].[Target.Id,TargetHealth.State]" --output text
