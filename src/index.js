const path = require('path')
const os = require('os')
const fs = require('fs')
const arc = require('@architect/functions')
const Jimp = require('jimp')
const aws = require('aws-sdk')
const { createHash } = require('crypto')
const normalizedStringify = require('json-stable-stringify')



module.exports = {
  package: function ({ /* arc,*/ cloudformation }) {

    // user must add the "get /transform/*" route to manifest file
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
  },


  sandbox: {
    start: function ( /* { arc, inventory, services }*/ _,  callback) {
      callback()
    }
  },

  variables: function ({ /*  arc, cloudformation,*/ stage, inventory }) {
    const isLocal = stage === 'testing'
    let cacheBucket
    let staticDir
    let fingerprint
    if (isLocal) {
      cacheBucket = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-image-cache'))
      staticDir = inventory.inv._project.src + '/' + inventory.inv.static.folder
      fingerprint = inventory.inv.static.fingerprint
      return { cacheBucket, staticDir, fingerprint }
    }
    else return { cacheBucket: { 'Ref': 'ImageCacheBucket' },
      fingerprint: inventory.inv.static.fingerprint
    }
  },


  imageHandler: async function (req){
    console.time('transform time')
    const discovery = await arc.services()
    let Region = process.env.AWS_REGION
    let cacheBucket = discovery['arc-image-plugin'].cacheBucket
    let localStaticDir = discovery['arc-image-plugin'].staticDir
    let fourOhFour = { statusCode: 404 }
    let fingerprint = discovery['arc-image-plugin'].fingerprint
    function antiCache ({ mime }) {
      return {
        'cache-control': 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
        'content-type': `${mime}; charset=utf8`,
        isBase64Encoded: true
      }
    }
    function longCache ({ mime }) {
      return  {
        'cache-control': 'max-age=31536000',
        'content-type': `${mime}; charset=utf8`,
        isBase64Encoded: true
      }
    }
    function imageResponse ({ mime, buffer }){
      return { statusCode: 200,
        headers: fingerprint ? longCache({ mime }) : antiCache({ mime }),
        body: buffer.toString('base64')
      }
    }


    // Validate request parameters
    let rawPath = req.rawPath
    let imagePath = rawPath.replace(/^\/transform\//i, '')
    let query = req.queryStringParameters

    let allowedParams = {
      width: query?.width,
      height: query?.height,
      grayscale: query?.grayscale,
      quality: query?.quality,
      scaleToFit: query?.scaleToFit,
      cover: query?.cover,
      contain: query?.contain,
    }

    let hash = createHash('sha256')
    hash.update(`${imagePath}:${normalizedStringify(allowedParams)}`)
    let queryFingerprint =  hash.digest('hex').slice(0, 10)
    let ext = path.extname(imagePath).slice(1)
    if (!(ext === 'jpg' || ext === 'jpeg' || ext === 'png')) return fourOhFour
    let mime = ext === 'jpg' ? `image/jpeg` : `image/${ext}`

    // check cache
    let s3 = new aws.S3({ Region })

    let buffer
    let env = process.env.ARC_ENV || process.env.NODE_ENV
    let isLive = (env === 'staging' || env === 'production')

    let exists = true
    if (isLive) {
    // read from s3
      let Bucket = cacheBucket
      let Key = `${queryFingerprint}.${ext}`
      try {
        let result = await s3.getObject({ Bucket, Key, }).promise()
        buffer = result.Body
      }
      catch (e){
        console.log('cached image not found')
        exists = false
      }
    }
    else {
    // read from local filesystem
      let pathToFile = path.join(cacheBucket, `${queryFingerprint}.${ext}`)
      try {
        buffer = fs.readFileSync(pathToFile)
      }
      catch (e){
        console.log('cached image not found')
        exists = false
      }
    }

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
        console.log(`original image not found in ${Bucket} ${Key}`)
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
        console.log('original image not found')
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
      console.timeEnd('transform time')
      return fourOhFour
    }
  }

}

