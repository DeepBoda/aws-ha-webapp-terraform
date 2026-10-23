# Deployment screenshots

Captured from the live deployment in ap-south-1 on 23 Oct 2026.

### 1. The app over HTTPS
Serving instance and AZ, database over TLS, S3 write and read, and a 30 request burst split across both zones.

![App over HTTPS](01-app-https.png)

### 2. Target group
Both instances healthy, one in each AZ.

![ALB targets](02-alb-targets.png)

### 3. Auto Scaling Group
2 to 4 instances from the launch template, spread over ap-south-1a and ap-south-1b.

![Auto Scaling Group](03-asg.png)

### 4. RDS MySQL
Encrypted storage, credentials managed in Secrets Manager, custom parameter group that requires TLS.

![RDS](04-rds.png)

### 5. Secrets Manager
The database master password, generated and owned by RDS. It never appears in code, state or user data.

![Secrets Manager](05-secrets-manager.png)

### 6. ALB access logs in S3
Log files arriving every few minutes under `alb/AWSLogs/`.

![ALB logs in S3](06-s3-alb-logs.png)

### 7 and 8. GitHub Actions workflows
GitHub has Actions disabled on this account at the moment (a support ticket is open; it is not related to the code), so there are no run screenshots yet. The workflows are below, and releases were run by hand with the same steps.

![Terraform workflow](07-workflow-terraform.png)

![Application workflow](08-workflow-app.png)

### 9. Terraform
Output of the last apply, then a fresh plan against the live account: no changes, so the infrastructure matches the code.

![Terraform apply and plan](09-terraform-apply.png)
