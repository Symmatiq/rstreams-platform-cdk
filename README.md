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

## Useful Commands

* `npm run build`   - Compile TypeScript to JavaScript
* `npm run watch`   - Watch for changes and compile
* `npm run test`    - Perform the Jest unit tests
* `cdk deploy`      - Deploy this stack to your default AWS account/region
* `cdk diff`        - Compare deployed stack with current state
* `cdk synth`       - Emits the synthesized CloudFormation template

## Security

This infrastructure follows AWS best practices for security. The IAM roles created have the minimum required permissions to function.

## Customization

To customize the infrastructure, modify the appropriate files in the `lib/` directory:

- `rstreams-platform-stack.ts` - Main stack definition
- `constructs/` directory - Individual components like Auth, Bus, etc.
- `helpers/` directory - Utility functions and mappings

## Migration from CloudFormation

This CDK project is a direct port of the original CloudFormation template. It maintains all the same resources, configurations, and dependencies, but takes advantage of CDK's programming model for better maintainability.
