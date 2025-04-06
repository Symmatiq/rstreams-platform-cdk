import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface ApiRoleProps {
  stackName: string;
}

/**
 * Creates the API Role used by the RStreams platform
 */
export class ApiRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: ApiRoleProps) {
    super(scope, id);

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.AccountRootPrincipal()
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    // Add custom policy for lambda permissions
    this.role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:AddPermission'],
      resources: ['*']
    }));

    // Add custom policy for lambda invocation
    this.role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [
        cdk.Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${AWS::StackName}-*', {
          'AWS::StackName': props.stackName
        })
      ]
    }));
  }
}
