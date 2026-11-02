# Setup notes

## What is this

Task was: put a web app on AWS so it stays up if one server or one AZ goes down, all with Terraform, with CI/CD.

So the stack is: ALB with HTTPS in front, EC2 instances in an Auto Scaling Group across 2 AZs, RDS MySQL in private subnets, secrets in Secrets Manager, logs in S3, alarms in CloudWatch.

App itself is small on purpose. It shows which instance and AZ answered, checks MySQL over TLS, writes to S3 and counts visits per AZ. So you can see the HA working in the browser.

## How I did it

1. Wrote `bootstrap/` first: S3 bucket for terraform state and a GitHub OIDC role, so CI never needs AWS keys.
2. Split `infra/` in modules: network, security, storage, database, certificate, alb, compute, monitoring. One job each.
3. Deployed on 22 Oct to my own AWS account, ap-south-1, domain `devops-task.deepboda.in`.
4. My DNS is at GoDaddy, not Route 53. Added `create_dns_zone = false` so it works with 2 CNAMEs (cert validation + domain to ALB).
5. Account is on AWS Free plan, RDS allows only 1 day backup there. Made backup days a variable (`db_backup_retention_days`).
6. GitHub had Actions blocked on my whole account (account thing, not the code, ticket raised). So I ran the same steps as `app.yml` by hand: package app, upload to S3 `releases/`, put version in SSM, start instance refresh.
7. MySQL 8.0 was going into paid extended support on RDS, so moved to MySQL 8.4 LTS.
8. Made the status page nicer, it records every visit in MySQL with the AZ that served it.
9. Took console screenshots on 23 Oct and submitted.
10. On 2 Nov, before teardown: ran `scripts/check.sh` (all good), ran `scripts/failover-test.sh` (killed one instance, 43 requests, 0 failed, replaced in 74s), ran `terraform plan` (only a newer Amazon Linux AMI showed up).
11. Teardown: emptied app and log buckets (they are not force deleted on purpose), `terraform destroy` in infra (71 resources), then bootstrap (role and OIDC, 3 resources). State bucket has `prevent_destroy` in code, so I kept that line, removed it from state and deleted it with aws cli. Also deleted the RDS error log group AWS leaves behind. Checked nothing is left.

## Run it again

```bash
cd bootstrap && terraform init && terraform apply -var github_repo=<owner>/<repo>
cd ../infra
cp backend.hcl.example backend.hcl            # put state bucket name
cp terraform.tfvars.example terraform.tfvars  # put your domain
terraform init -backend-config=backend.hcl
terraform apply
```

Add the DNS records (see README), then release the app. RDS and the cert validation are the slow parts of the first apply.

## Check its working

```bash
./scripts/check.sh            # https, health, AZ split, targets, ASG, RDS, alarms, logs
./scripts/failover-test.sh    # kill one instance, site should stay up
```

Both read names from `terraform output`, so run them after apply.

## Variables

- `infra/terraform.tfvars` - domain, sizes, Multi-AZ, backups, alarm email. Not in git.
- `infra/backend.hcl` - state bucket. Not in git.
- GitHub repo variables - role arn, state bucket, domain, region, optional ones. Listed in README.
- No AWS keys anywhere. CI uses OIDC, instances use IAM role, db password lives in Secrets Manager only.

## Remove it

```bash
# empty the 2 buckets first (app bucket is versioned, delete versions too)
cd infra && terraform destroy
```

Then remove the 2 DNS records at your provider. Bootstrap only if you are done with the account.

## Things to know

- Cost is ~3 to 4 USD a day, NAT Gateway and ALB are most of it.
- Defaults are cheap mode: single NAT, single AZ database. For real prod turn on `db_multi_az`, `nat_gateway_per_az`, `db_deletion_protection`.
- `/health` does not touch the database, so a db blip does not make ASG kill healthy instances. `/health/db` is separate.
