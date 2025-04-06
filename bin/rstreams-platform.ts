#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RStreamsPlatformStack } from '../lib/rstreams-platform-stack';

const app = new cdk.App();
// Get the stack name from context or use a default
const stackName = app.node.tryGetContext('stack-name') || 'RStreamsPlatformStack';

new RStreamsPlatformStack(app, stackName, {
  /* If you don't specify 'env', this stack will be environment-agnostic. */
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  description: 'RStreams Platform Stack',
  environmentName: app.node.tryGetContext('environment') || 'dev', // Use environmentName and a default like 'dev'
});

app.synth();
