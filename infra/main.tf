terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 4.39"
    }
  }

  required_version = ">= 1.2.0"
}

variable "aws_region" { type = string }
variable "customer" { type = string }
variable "vpc_id" { type = string }
variable "vpc_subnet_1" { type = string }
variable "vpc_subnet_2" { type = string }
variable "route53_zone_id" { type = string }
variable "app_name" { 
  type = string
  default = "intercom"
}
variable "mongodb_ssh_pub_key" { type = string }
variable "cluster_arn" { type = string }
variable "alb_listener_arn" { type = string }
variable "alb_dns_name" { type = string }
variable "manager_task_def_arn" { type = string }

provider "aws" {
  region = var.aws_region
}

data "aws_ami" "mongodb" {
  most_recent = true

  filter {
    name   = "name"
    values = ["mongodb-base-linux-aws"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  owners = ["self"]
}

resource "aws_key_pair" "mongodb_ssh_key" {
  key_name   = "mongodb-${terraform.workspace}-ssh-key"
  public_key = var.mongodb_ssh_pub_key
}

resource "aws_security_group" "mongodb_security_group" {
  vpc_id = var.vpc_id

  ingress {
    from_port = 22
    to_port = 22
    protocol        = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    from_port       = 27017
    to_port         = 27017
    protocol        = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name        = "${var.app_name}-mongodb-${terraform.workspace}-sg"
    Customer    = var.customer
    Environment = terraform.workspace
  }
}

resource "aws_instance" "mongodb" {
  ami           = data.aws_ami.mongodb.id
  instance_type = "t3.micro"
  associate_public_ip_address = true
  key_name = aws_key_pair.mongodb_ssh_key.key_name
  subnet_id = var.vpc_subnet_1
  vpc_security_group_ids = [ aws_security_group.mongodb_security_group.id ]

  tags = {
    Name = "${var.app_name}-mongodb-${terraform.workspace}"
    Customer    = var.customer
    Environment = terraform.workspace
  }
}

resource "aws_route53_record" "mongodb_dns_record" {
  zone_id = var.route53_zone_id
  name    = "${var.app_name}-mongodb.${terraform.workspace}.eyevinn.technology"
  type    = "A"
  ttl     = 300
  records = [aws_instance.mongodb.public_ip]
}

resource "aws_lb_target_group" "manager_target_group" {
  name        = "tg-${var.app_name}-manager-${terraform.workspace}"
  port        = 8000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    healthy_threshold   = "3"
    interval            = "300"
    protocol            = "HTTP"
    matcher             = "200"
    timeout             = "3"
    path                = "/"
    unhealthy_threshold = "2"
  }

  tags = {
    Name        = "${var.app_name}-manager-${terraform.workspace}-lb-tg"
    Customer    = var.customer
    Environment = terraform.workspace
  }
}

resource "aws_lb_listener_rule" "manager_listener_rule" {
  listener_arn = var.alb_listener_arn
  priority     = 100

  action {
    type = "forward"
    target_group_arn = aws_lb_target_group.manager_target_group.arn
  }

  condition {
    host_header {
      values = ["${var.app_name}-manager.${terraform.workspace}.eyevinn.technology"]
    }
  }

}

resource "aws_security_group" "manager_service_security_group" {
  vpc_id = var.vpc_id

  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name        = "${var.app_name}-manager-service-${terraform.workspace}-sg"
    Customer    = var.customer
    Environment = terraform.workspace
  }
}


resource "aws_ecs_service" "ecs_manager_service" {
  name                 = "${var.app_name}-manager"
  cluster              = var.cluster_arn
  task_definition      = var.manager_task_def_arn
  launch_type          = "FARGATE"
  scheduling_strategy  = "REPLICA"
  desired_count        = 1
  force_new_deployment = true

  network_configuration {
    subnets          = [ var.vpc_subnet_1, var.vpc_subnet_2 ]
    assign_public_ip = true
    security_groups = [ aws_security_group.manager_service_security_group.id ]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.manager_target_group.arn
    container_name   = "${var.app_name}-manager"
    container_port   = 8000
  }

  tags = {
    Customer = var.customer
    Environment = terraform.workspace
  }
}

resource "aws_route53_record" "manager_dns_record" {
  zone_id = var.route53_zone_id
  name    = "${var.app_name}-manager.${terraform.workspace}.eyevinn.technology"
  type    = "CNAME"
  ttl     = 300
  records = [var.alb_dns_name]
}
