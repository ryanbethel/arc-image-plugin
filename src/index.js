const path = require('path')
const os = require('os')
const fs = require('fs')


module.exports = {
  set: {
    http: function () {
      return { method: 'get', path: '/transform/*', src: './node_modules/@ryanbethel/arc-image-plugin/src/image-handler', config: { timeout: 30 } }
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

<<<<<<< HEAD
    if (exists) {
      console.timeEnd('transform time')
      return imageResponse({ mime, buffer })
    }

    // Transform
    // 1. first get the original image
    exists = true
    if (isLive) {
    // read from s3
      let Bucket = discovery['static']['bucket']
      let Key = `${imagePath}`
      try {
        let result = await s3.getObject({ Bucket, Key, }).promise()
        buffer = result.Body
      }
      catch (e) {
        exists = false
      }
    }
    else {
    // read from local filesystem
    // let pathToStatic = path.join(__dirname, '../../../public' )
      let pathToStatic = localStaticDir
      let pathToFile = path.join(pathToStatic, imagePath)
      try {
        buffer = fs.readFileSync(pathToFile)
      }
      catch (e){
        exists = false
      }
    }


    // 2. transform it
    if (exists){
      let Key = `${queryFingerprint}.${ext}`
      let image = await Jimp.read(buffer)
      if (allowedParams.grayscale || allowedParams.grayscale === '') image.grayscale()
      if (allowedParams.quality) image.quality(allowedParams.quality)
      let height = allowedParams.height ? Number.parseInt(allowedParams.height) : Jimp.AUTO
      let width = allowedParams.width ? Number.parseInt(allowedParams.width) : Jimp.AUTO

      if (allowedParams.scaleToFit || allowedParams.scaleToFit === '') image.scaleToFit(width, height)
      else if (allowedParams.contain || allowedParams.contain === '') image.contain(width, height)
      else if (allowedParams.cover || allowedParams.cover === '') image.cover(width, height)
      else if (allowedParams.width || allowedParams.height ) image.scaleToFit(width, height)

      // save to cache
      let output = await image.getBufferAsync(Jimp.AUTO)
      if (isLive) {
        await s3.putObject({
          ContentType: mime,
          Bucket: cacheBucket,
          Key,
          Body: output,
        }).promise()
      }
      else {
        fs.writeFileSync(path.resolve(cacheBucket, Key), output)
      }

      // 4. respond with the image
      console.timeEnd('transform time')
      return imageResponse({ mime, buffer: output })
    }
    else {
      return fourOhFour
    }
  }
=======
>>>>>>> a38e9707e7bda6ef0ffc10719dea556e58900a39

}

