variable "name" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "azs" {
  description = "Availability Zones to use, one subnet per tier in each."
  type        = list(string)
}

variable "nat_gateway_per_az" {
  type    = bool
  default = false
}
