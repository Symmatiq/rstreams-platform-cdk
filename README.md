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

### AWS Cloud Deployment

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

To deploy a specific stack only:

```
cdk deploy MyStackName
```

To deploy with approval disabled (use cautiously):

```
cdk deploy --require-approval never
```

### LocalStack Deployment

[LocalStack](https://localstack.cloud/) provides a local AWS cloud stack for development and testing. Follow these steps to deploy the RStreams platform on LocalStack:

1. **Install and Start LocalStack**:
   ```
   npm install -g localstack
   localstack start
   ```

   Or using Docker:
   ```
   docker run --name localstack -p 4566:4566 -p 4510-4559:4510-4559 localstack/localstack
   ```

2. **Install the CDK LocalStack Toolkit**:
   ```
   npm install -g aws-cdk-local aws-cdk-lib
   ```

3. **Configure AWS CLI for LocalStack**:
   ```
   aws configure --profile localstack
   AWS Access Key ID [None]: test
   AWS Secret Access Key [None]: test
   Default region name [None]: us-east-1
   Default output format [None]: json
   ```

4. **Bootstrap CDK for LocalStack**:
   ```
   cdklocal bootstrap aws://000000000000/us-east-1 --profile localstack
   ```

5. **Deploy to LocalStack**:
   ```
   cdklocal deploy --profile localstack
   ```

   Or with specific context parameters:
   ```
   cdklocal deploy --context environment=dev --profile localstack
   ```

6. **Verify Deployment**:
   ```
   aws --endpoint-url=http://localhost:4566 cloudformation list-stacks --profile localstack
   ```

#### LocalStack Limitations

- Some AWS services may not be fully supported in LocalStack's free tier
- Cognito User Pools have limited functionality in LocalStack
- Cross-region replication features may not work as expected in LocalStack

### Programmatic Deployment

You can deploy the stack programmatically using AWS SDK and CDK API.

#### Deploy to AWS Cloud

```javascript
const { execSync } = require('child_process');

function deployCdkStack(stackName, environment, region) {
  console.log(`Deploying stack ${stackName} to ${environment} in ${region}...`);
  
  try {
    const command = `cdk deploy ${stackName} --context environment=${environment} --region ${region}`;
    execSync(command, { stdio: 'inherit' });
    
    console.log(`Stack ${stackName} deployed successfully!`);
    return true;
  } catch (error) {
    console.error(`Failed to deploy stack ${stackName}:`, error);
    return false;
  }
}

// Example usage
deployCdkStack('RStreamsPlatformStack', 'dev', 'us-east-1');
```

#### Deploy to LocalStack

```javascript
const { execSync } = require('child_process');

function deployToLocalStack(stackName, environment) {
  console.log(`Deploying ${stackName} to LocalStack in ${environment} environment...`);
  
  try {
    const command = `cdklocal deploy ${stackName} --context environment=${environment} --profile localstack`;
    execSync(command, { stdio: 'inherit' });
    
    console.log(`Stack ${stackName} deployed successfully to LocalStack!`);
    return true;
  } catch (error) {
    console.error(`Failed to deploy stack ${stackName} to LocalStack:`, error);
    return false;
  }
}

// Example usage
deployToLocalStack('RStreamsPlatformStack', 'local');
```

#### Deploy Using CDK API

```javascript
const cdk = require('aws-cdk-lib');
const { RStreamsPlatformStack } = require('./lib/rstreams-platform-stack');

async function deployWithCdkApi(environment, region, account) {
  // Create CDK app
  const app = new cdk.App({
    context: {
      environment: environment
    }
  });
  
  // Create stack with configuration
  const stack = new RStreamsPlatformStack(app, 'RStreamsPlatform', {
    environmentName: environment,
    env: {
      region: region,
      account: account
    }
  });
  
  // Synthesize CloudFormation template
  const assembly = app.synth();
  
  // Deploy using CloudFormation API
  const cfn = new cdk.aws_cloudformation.CloudFormation({
    region: region,
    credentials: { /* your credentials here */ }
  });
  
  await cfn.createOrUpdateStack({
    stackName: stack.stackName,
    templateBody: assembly.getStackByName(stack.stackName).template,
    capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND']
  }).promise();
  
  console.log(`Stack ${stack.stackName} deployed successfully!`);
}

// Example usage
deployWithCdkApi('dev', 'us-east-1', '123456789012').catch(console.error);
```

### Custom Stack Names

You can customize the CloudFormation stack name during deployment using one of the following methods:

1. **Using the `--stack-name` parameter with `cdk deploy`**:
   ```
   cdk deploy --stack-name MyCustomRStreamsStack
   ```

2. **Specifying the name in the stack constructor** (in your code):
   ```typescript
   new RStreamsPlatformStack(app, 'MyStack', {
     stackName: 'MyCustomRStreamsStack',
     // other props...
   });
   ```

3. **Using context variables with CDK deploy**:
   ```
   cdk deploy -c stackName=MyCustomRStreamsStack
   ```
   
   Then use it in your code:
   ```typescript
   const stackName = app.node.tryGetContext('stackName') || 'DefaultStackName';
   new RStreamsPlatformStack(app, 'MyStack', {
     stackName: stackName,
     // other props...
   });
   ```

Using a custom stack name can be useful for creating multiple isolated instances of the RStreams infrastructure or for adhering to your organization's naming conventions.

## Programmatic Usage in Node.js

You can also use the RStreams Platform CDK stack programmatically in your Node.js applications. This allows you to integrate and manage RStreams infrastructure as part of your application code.

### Basic Usage

Create a new file (e.g., `deploy.js`) with the following content:

```javascript
const cdk = require('aws-cdk-lib');
const { RStreamsPlatformStack } = require('./lib/rstreams-platform-stack');

// Create app and stack
const app = new cdk.App({
  context: {
    environment: 'dev',
    // Add other context variables as needed
  }
});

// Create the stack with custom properties
const stack = new RStreamsPlatformStack(app, 'MyRStreamsStack', {
  environmentName: 'dev',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  // Add other stack properties as needed
});

// Synthesize the CloudFormation template
app.synth();
```

### Access Stack Outputs

To access the stack outputs programmatically after deployment:

```javascript
const AWS = require('aws-sdk');
const cloudformation = new AWS.CloudFormation();

async function getStackOutputs(stackName) {
  const response = await cloudformation.describeStacks({ StackName: stackName }).promise();
  
  if (response.Stacks && response.Stacks.length > 0) {
    const outputs = response.Stacks[0].Outputs;
    return outputs.reduce((acc, output) => {
      acc[output.OutputKey] = output.OutputValue;
      return acc;
    }, {});
  }
  
  throw new Error(`Stack ${stackName} not found`);
}

async function getResourceNames() {
  const outputs = await getStackOutputs('MyRStreamsStack');
  console.log('LeoStream Table:', outputs.LeoStream);
  console.log('LeoCron Table:', outputs.LeoCron);
  // Access other outputs as needed
}

getResourceNames().catch(console.error);
```

### Access Resource Information Using Secrets Manager

The RStreams Platform CDK stack creates a secret in AWS Secrets Manager named `rstreams-<stackname>` containing information about all resources. You can access this secret programmatically:

```javascript
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

async function getRStreamsResources(stackName) {
  const client = new SecretsManagerClient();
  const command = new GetSecretValueCommand({
    SecretId: `rstreams-${stackName}`
  });
  
  const response = await client.send(command);
  return JSON.parse(response.SecretString);
}

async function useRStreamsResources() {
  const resources = await getRStreamsResources('MyRStreamsStack');
  
  // Now you can use the resource names in your application
  console.log('Stream Table:', resources.LeoStream);
  console.log('Kinesis Stream:', resources.LeoKinesisStream);
  
  // Example: Configure AWS SDK with the resources
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
  
  const client = new DynamoDBClient({ region: resources.Region });
  const docClient = DynamoDBDocumentClient.from(client);
  
  // Example: Query the LeoStream table
  const command = new QueryCommand({
    TableName: resources.LeoStream,
    KeyConditionExpression: 'event = :event',
    ExpressionAttributeValues: {
      ':event': 'my-event'
    }
  });
  
  const result = await docClient.send(command);
  console.log('Query results:', result.Items);
}

useRStreamsResources().catch(console.error);
```

### Programmatically Deploy Multiple Stacks

To deploy multiple stacks with different configurations:

```javascript
const cdk = require('aws-cdk-lib');
const { RStreamsPlatformStack } = require('./lib/rstreams-platform-stack');

async function deployStacks() {
  const app = new cdk.App();
  
  // Deploy dev stack
  const devStack = new RStreamsPlatformStack(app, 'RStreamsDev', {
    environmentName: 'dev',
    env: { region: 'us-east-1' }
  });
  
  // Deploy prod stack
  const prodStack = new RStreamsPlatformStack(app, 'RStreamsProd', {
    environmentName: 'prod',
    env: { region: 'us-west-2' }
  });
  
  app.synth();
  
  // You can use AWS SDK to deploy these stacks programmatically
  // or use the CDK CLI programmatically
}

deployStacks().catch(console.error);
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
