#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

class TestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Test Role with empty inline policy array to reproduce the issue
    const testRole = new iam.Role(this, 'TestRole', {
      roleName: 'test-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    
    // Add policy with statements rather than using inlinePolicies
    testRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: ['*']
    }));
  }
}

const app = new cdk.App();
new TestStack(app, 'TestStack'); 