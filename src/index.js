const path = require('path')
const os = require('os')
const fs = require('fs')


module.exports = {
  set: {
    http: function () {
      return { method: 'get', path: '/transform/*', src: './node_modules/@ryanbethel/arc-image-plugin/src/image-handler', config: { timeout: 30, runtime:'nodejs16.x' } }
    },
    env: function ({ arc }) {
      const localCacheBucket = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-image-cache'))
      const fingerprint = arc?.static?.fingerprint || false
      return {
        testing: {
          ARC_IMAGE_PLUGIN_FINGERPRINT: fingerprint,
          ARC_IMAGE_PLUGIN_LOCAL_CACHE: localCacheBucket  }
      }
    },
  },
  deploy: {
    services: function ({ stage }){
      return {
        'arc-image-plugin-cache-bucket': stage !== 'testing' ?  { 'Ref': 'ImageCacheBucket' } : '',
      }
    },
    start: function ({ /* arc,*/ cloudformation }) {

      if (cloudformation.Resources.HTTP.Properties.DefinitionBody.paths['/transform/{proxy+}']) {

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
  },


}

