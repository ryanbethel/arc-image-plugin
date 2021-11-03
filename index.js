let path = require('path')


function package ({ arc, cloudformation, stage }) {


  let appName = arc.app
  let transformSrc = path.resolve(__dirname, './src')


  if (!cloudformation.HTTP.paths['/transform/{proxy+}']) {

    cloudformation.HTTP.paths['/transform/{proxy+}'] = {
      'get': {
        'x-amazon-apigateway-integration': {
          'payloadFormatVersion': '2.0',
          'type': 'aws_proxy',
          'httpMethod': 'POST',
          'uri': {
            'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetTransformCatchallHTTPLambda.Arn}/invocations'
          },
          'connectionType': 'INTERNET'
        }
      }
    }


    cloudformation.Resources['GetTransformCatchallHTTPLambda'] = {
      'Type': 'AWS::Serverless::Function',
      'Properties': {
        'Handler': 'index.handler',
        'CodeUri': transformSrc,
        'Runtime': 'nodejs12.x',
        'Architectures': [
          'x86_64'
        ],
        'MemorySize': 1152,
        'Timeout': 30,
        'Environment': {
          'Variables': {
            'ARC_APP_NAME': appName,
            'ARC_CLOUDFORMATION': {
              'Ref': 'AWS::StackName'
            },
            'ARC_ENV': stage,
            'ARC_ROLE': {
              'Ref': 'Role'
            },
            'NODE_ENV': stage,
            'SESSION_TABLE_NAME': 'jwe',
            'ARC_STATIC_BUCKET': {
              'Ref': 'StaticBucket'
            },
            'ARC_STORAGE_PRIVATE_IMAGE_CACHE': {
              'Ref': 'ImageCacheBucket'
            }
          }
        },
        'Role': {
          'Fn::Sub': [
            'arn:aws:iam::${AWS::AccountId}:role/${roleName}',
            {
              'roleName': {
                'Ref': 'Role'
              }
            }
          ]
        },
        'Events': {
          'GetTransformCatchallHTTPEvent': {
            'Type': 'HttpApi',
            'Properties': {
              'Path': '/transform/{proxy+}',
              'Method': 'GET',
              'ApiId': {
                'Ref': 'HTTP'
              }
            }
          }
        },
      }
    }


    cloudformation.Resources['PrivateStorageMacroPolicy'] = {
      'Type': 'AWS::IAM::Policy',
      'DependsOn': 'Role',
      'Properties': {
        'PolicyName': 'PrivateStorageMacroPolicy',
        'PolicyDocument': {
          'Statement': [
            {
              'Effect': 'Allow',
              'Action': [
                's3:*'
              ],
              'Resource': [
                {
                  'Fn::Sub': [
                    'arn:aws:s3:::${bucket}',
                    {
                      'bucket': {
                        'Ref': 'ImageCacheBucket'
                      }
                    }
                  ]
                },
                {
                  'Fn::Sub': [
                    'arn:aws:s3:::${bucket}/*',
                    {
                      'bucket': {
                        'Ref': 'ImageCacheBucket'
                      }
                    }
                  ]
                }
              ]
            }
          ]
        },
        'Roles': [
          {
            'Ref': 'Role'
          }
        ]
      }
    }

    cloudformation.Resources['ImageCacheBucket'] = {
      'Type': 'AWS::S3::Bucket',
      'DeletionPolicy': 'Delete',
      'Properties': {
        'PublicAccessBlockConfiguration': {
          'BlockPublicAcls': true,
          'BlockPublicPolicy': true,
          'IgnorePublicAcls': true,
          'RestrictPublicBuckets': true
        },
        'BucketEncryption': {
          'ServerSideEncryptionConfiguration': [
            {
              'ServerSideEncryptionByDefault': {
                'SSEAlgorithm': 'AES256'
              }
            }
          ]
        }
      }
    }

    cloudformation.Resources['ImageCacheParam'] = {
      'Type': 'AWS::SSM::Parameter',
      'Properties': {
        'Type': 'String',
        'Name': {
          'Fn::Sub': [
            '/${AWS::StackName}/storage-private/${bucket}',
            {
              'bucket': 'image-cache'
            }
          ]
        },
        'Value': {
          'Ref': 'ImageCacheBucket'
        }
      }
    }


  }


  return cloudformation
}

module.exports = { package }
