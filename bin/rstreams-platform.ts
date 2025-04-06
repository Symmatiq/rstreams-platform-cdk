#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RStreamsPlatformStack } from '../lib/rstreams-platform-stack';

const app = new cdk.App();
new RStreamsPlatformStack(app, 'RStreamsPlatformStack', {
  /* If you don't specify 'env', this stack will be environment-agnostic. */
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  description: 'RStreams Platform Stack',
  environmentName: app.node.tryGetContext('environment') || 'dev', // Use environmentName and a default like 'dev'
});

app.synth();
