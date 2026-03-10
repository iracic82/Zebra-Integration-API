import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';

const CUSTOM_DOMAIN = 'zebra-api.highvelocitynetworking.com';
const ACM_CERT_ARN =
  'arn:aws:acm:us-east-1:905418046272:certificate/1be0a191-5d5c-4401-ac3e-4a8ddad6e1f6';
const SECRET_NAME = 'zebra-visibilityiq/api-keys';

export class ZebraIntegrationApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── Secrets Manager (existing secret) ────────────────────────
    const apiKeysSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'ZebraApiKeys',
      SECRET_NAME
    );

    // ─── DynamoDB Table ───────────────────────────────────────────
    const table = new dynamodb.Table(this, 'ZebraDataTable', {
      tableName: 'zebra-visibilityiq-data',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: false,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ─── Lambda Function (API Handler) ────────────────────────────
    const apiHandler = new nodejs.NodejsFunction(this, 'ZebraApiHandler', {
      functionName: 'zebra-visibilityiq-api',
      entry: path.join(__dirname, '..', 'lambda', 'handlers', 'api.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        SECRET_NAME: SECRET_NAME,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
      },
    });

    table.grantReadWriteData(apiHandler);
    apiKeysSecret.grantRead(apiHandler);

    // Lambda Function URL (for CloudFront origin)
    const functionUrl = apiHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    // ─── Seed Data Lambda ─────────────────────────────────────────
    const seedHandler = new nodejs.NodejsFunction(this, 'ZebraSeedHandler', {
      functionName: 'zebra-visibilityiq-seed',
      entry: path.join(__dirname, '..', 'lambda', 'handlers', 'seed.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
      },
    });

    table.grantReadWriteData(seedHandler);

    // Custom resource to auto-seed on deploy
    const seedTrigger = new cr.AwsCustomResource(this, 'SeedTrigger', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: seedHandler.functionName,
          InvocationType: 'Event',
          Payload: JSON.stringify({ action: 'seed' }),
        },
        physicalResourceId: cr.PhysicalResourceId.of('zebra-seed-trigger-v1'),
      },
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: seedHandler.functionName,
          InvocationType: 'Event',
          Payload: JSON.stringify({ action: 'seed' }),
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          `zebra-seed-trigger-${Date.now()}`
        ),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: [seedHandler.functionArn],
        }),
      ]),
    });

    seedTrigger.node.addDependency(table);

    // ─── ACM Certificate (existing) ──────────────────────────────
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'ZebraApiCert',
      ACM_CERT_ARN
    );

    // ─── CloudFront Distribution ──────────────────────────────────
    const functionUrlDomain = cdk.Fn.select(
      2,
      cdk.Fn.split('/', functionUrl.url)
    );

    const distribution = new cloudfront.Distribution(
      this,
      'ZebraApiDistribution',
      {
        comment: 'Zebra VisibilityIQ Mock API',
        domainNames: [CUSTOM_DOMAIN],
        certificate,
        defaultBehavior: {
          origin: new origins.HttpOrigin(functionUrlDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      }
    );

    // ─── Outputs ──────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `https://${CUSTOM_DOMAIN}`,
      description: 'Zebra VisibilityIQ Mock API URL (custom domain)',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront domain (for CNAME target)',
    });

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: functionUrl.url,
      description: 'Lambda Function URL (direct)',
    });

    new cdk.CfnOutput(this, 'DynamoDBTable', {
      value: table.tableName,
      description: 'DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    new cdk.CfnOutput(this, 'SecretArn', {
      value: apiKeysSecret.secretArn,
      description: 'API Keys Secret ARN',
    });
  }
}
