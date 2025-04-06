# RStreams Platform CDK

This project contains the AWS CDK implementation of the RStreams platform infrastructure. It recreates the same resources as the original CloudFormation template, but using CDK for better maintainability and infrastructure as code principles.

## Architecture

The infrastructure consists of:

1. **Main Stack** - The primary CDK stack that orchestrates all other components
2. **Nested Stacks**:
   - **Auth Stack** - Authentication services for RStreams
   - **Bus Stack** - Core message bus for streaming microservices
   - **Cognito Stack** - User authentication and identity management
   - **Botmon Stack** - Monitoring and dashboard services

## Key Features

- **Queue Replication** - Supports replication between source and destination queues
- **Runtime Configuration** - Configurable Lambda runtimes to stay current with AWS requirements
- **Resource Naming Strategy** - Prevents name collisions when deploying to the same region
- **Existing Resource Integration** - Can integrate with existing Cognito identity pools
- **DynamoDB Auto-scaling** - Configurable capacity with auto-scaling capabilities

## Prerequisites

- Node.js 14.x or later
- AWS CLI configured with appropriate credentials
- AWS CDK installed globally: `npm install -g aws-cdk`

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Bootstrap your AWS environment (if not already done):
   ```
   cdk bootstrap
   ```

## Configuration

The application can be configured via the `cdk.json` file or by providing context parameters during deployment:

- `environment` - The environment name (dev, staging, prod)
- `useExistingIdentityPool` - Set to true to use an existing Cognito identity pool
- `existingIdentityPoolId` - ID of the existing Cognito identity pool (when useExistingIdentityPool is true)
- `lambdaRuntime` - Override the default Lambda runtime
- `queueReplication` - Configure source and destination queue replication settings
- Various capacity settings for DynamoDB tables:
  - `leoStreamMinReadCapacity`/`leoStreamMaxReadCapacity` 
  - `leoStreamMinWriteCapacity`/`leoStreamMaxWriteCapacity`
  - etc.

## Deployment

To deploy the stack to your default AWS account/region:

```
cdk deploy
```

To deploy with specific parameters:

```
cdk deploy --context environment=production --context leoStreamMinReadCapacity=40
```

To deploy with queue replication enabled:

```
cdk deploy --context queueReplication='{"source": {"region": "us-east-1", "accountId": "1234567890"}, "destination": {"region": "us-west-2", "accountId": "0987654321"}}'
```

## Resource Naming Strategy

The CDK implementation handles resource naming to prevent collisions when deploying to the same region. Resources are prefixed with the stack name and use a truncation strategy for resources with name length limits (like IAM roles).

## Useful Commands

* `npm run build`   - Compile TypeScript to JavaScript
* `npm run watch`   - Watch for changes and compile
* `npm run test`    - Perform the Jest unit tests
* `cdk deploy`      - Deploy this stack to your default AWS account/region
* `cdk diff`        - Compare deployed stack with current state
* `cdk synth`       - Emits the synthesized CloudFormation template

## Security

This infrastructure follows AWS best practices for security. The IAM roles created have the minimum required permissions to function. The ApiRole construct provides a standardized approach to Lambda role creation with appropriate permissions.

## Customization

To customize the infrastructure, modify the appropriate files in the `lib/` directory:

- `rstreams-platform-stack.ts` - Main stack definition
- `constructs/` directory - Individual components like Auth, Bus, etc.
- `helpers/` directory - Utility functions and mappings

## Migration from CloudFormation

This CDK project is a direct port of the original CloudFormation template. It maintains all the same resources, configurations, and dependencies, but takes advantage of CDK's programming model for better maintainability.

## Troubleshooting

- **IAM Role Name Length Issues** - If you encounter IAM role name length errors, the stack uses name truncation helpers to ensure names stay within AWS limits
- **Missing Export Errors** - Ensure all required exports exist in the destination region when using cross-region functionality
- **DynamoDB Capacity** - Tune the DynamoDB capacity settings based on your workload requirements
