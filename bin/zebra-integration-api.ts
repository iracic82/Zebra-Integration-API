#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { ZebraIntegrationApiStack } from '../lib/zebra-integration-api-stack';

const app = new cdk.App();
new ZebraIntegrationApiStack(app, 'ZebraIntegrationApiStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Zebra VisibilityIQ Mock API - CloudFront + Lambda + DynamoDB',
});
