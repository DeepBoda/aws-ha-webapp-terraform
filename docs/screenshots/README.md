# Deployment screenshots

Captured from a live deployment:

1. `01-app-https.png`: the app over HTTPS, showing the serving instance, AZ, database (TLS) and storage checks
2. `02-alb-targets.png`: target group with both instances healthy across two AZs
3. `03-asg.png`: Auto Scaling Group, launch template and scaling policy
4. `04-rds.png`: RDS MySQL in private subnets, encrypted, not publicly accessible
5. `05-secrets-manager.png`: database credentials secret managed by RDS
6. `06-s3-alb-logs.png`: ALB access logs arriving in S3
7. `07-actions-terraform.png`: infrastructure pipeline: checks, plan, apply, HTTPS health check
8. `08-actions-app.png`: application pipeline: test, release, rolling refresh, live check
9. `09-terraform-apply.png`: terraform apply output
