import { execSync, ExecSyncOptions } from 'child_process';
import { RemovalPolicy, DockerImage, Stack } from 'aws-cdk-lib';
import {
  Distribution,
  SecurityPolicyProtocol,
  CachePolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  IUserPool,
  IUserPoolClient,
  CfnIdentityPool,
} from 'aws-cdk-lib/aws-cognito';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Source, BucketDeployment } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { copySync } from 'fs-extra';

interface SiteProps {
  apiUrl: string;
  concatBucket: Bucket;
  userPool: IUserPool;
  userPoolClient: IUserPoolClient;
  identityPool: CfnIdentityPool;
}

export class Site extends Construct {
  public readonly siteBucket: Bucket;
  public readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: SiteProps) {
    super(scope, id);

    this.siteBucket = new Bucket(this, 'websiteBucket', {
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new Distribution(this, 'CloudfrontDistribution', {
      enableLogging: true,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      errorResponses: [
        {
          httpStatus: 404,
          responsePagePath: '/index.html',
          responseHttpStatus: 200,
        },
        {
          httpStatus: 403,
          responsePagePath: '/index.html',
          responseHttpStatus: 200,
        },
      ],
      defaultBehavior: {
        origin: new S3Origin(this.siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
      },
      defaultRootObject: 'index.html',
    });
    const execOptions: ExecSyncOptions = { stdio: 'inherit' };

    const bundle = Source.asset('./site', {
      bundling: {
        command: [
          'sh',
          '-c',
          'echo "Docker build not supported. Please install esbuild."',
        ],
        image: DockerImage.fromRegistry('alpine'),
        local: {
          tryBundle(outputDir: string) {
            try {
              execSync('esbuild --version', execOptions);
            } catch {
              /* istanbul ignore next */
              return false;
            }
            execSync(
              'cd site && yarn install --frozen-lockfile && yarn build',
              execOptions,
            );
            copySync('./site/dist', outputDir, {
              ...execOptions,
              recursive: true,
            });
            return true;
          },
        },
      },
    });

    const config = {
      apiUrl: props.apiUrl,
      concatBucket: props.concatBucket.bucketName,
      userPoolRegion: Stack.of(this).region,
      userPoolId: props.userPool.userPoolId,
      userPoolClientId: props.userPoolClient.userPoolClientId,
      identityPoolId: props.identityPool.ref,
    };

    new BucketDeployment(this, 'DeployBucket', {
      sources: [bundle, Source.jsonData('config.json', config)],
      destinationBucket: this.siteBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });
  }
}
