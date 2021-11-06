let path = require('path')
let os = require('os')
let fs = require('fs')
let arc = require('@architect/functions')
let Jimp = require('jimp')
let sizeOf = require('image-size')
let aws = require('aws-sdk')
let { createHash } = require('crypto')


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
    if (isLocal) {
      cacheBucket = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-img-cache'))
      staticDir = inventory.inv._project.src + '/' + inventory.inv.static.folder
      return { cacheBucket, staticDir }
    }
    else return { cacheBucket: { 'Ref': 'ImageCacheBucket' } }
  },


  imageHandler: async function (req){
    const discovery = await arc.services()
    let Region = process.env.AWS_REGION
    let cacheBucket = discovery['image-plugin'].cacheBucket
    let localStaticDir = discovery['image-plugin'].staticDir

    // verify the request is properly formed
    let rawPath = req.rawPath
    let imagePath = rawPath.replace(/^\/transform\//i, '')
    let rawQuery = req.rawQueryString
    let hash = createHash('sha256')
    hash.update(`${imagePath}?${rawQuery}`)
    let queryFingerprint =  hash.digest('hex').slice(0, 10)
    let ext = path.extname(imagePath).slice(1)
    if (!(ext === 'jpg' || ext === 'png')) return { statusCode: 404 }
    req.queryFingerprint = queryFingerprint
    req.image = { path: imagePath, ext, mime: `image/${ext}` }

    // check cache
    // let queryFingerprint = req.queryFingerprint
    // let ext = req.image.ext
    let mime = req.image.mime
    // let discovery = await arc.services()
    let s3 = new aws.S3({ Region })

    let buffer
    let env = process.env.ARC_ENV || process.env.NODE_ENV
    let isLive = (env === 'staging' || env === 'production')

    let exists = true
    if (isLive) {
    // read from s3
    // let Bucket = discovery['storage-private']['image-cache']
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
    // let pathToCache = path.join(__dirname, '..', '..', '..', 'tmp-cache')
      let pathToFile = path.join(cacheBucket, `${queryFingerprint}.${ext}`)
      // let pathToFile = path.join(pathToCache, `${queryFingerprint}.${ext}`)
      try {
        buffer = fs.readFileSync(pathToFile)
      }
      catch (e){
        console.log('cached image not found')
        exists = false
      }
    }

    if (exists) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': mime, isBase64Encoded: true },
        body: buffer.toString('base64')
      }
    }

    // Transform
    // 1. first get the original image
    // let imagePath = req.image.path
    console.log(imagePath)
    let query = req.queryStringParameters
    let height = query.height
    let width = query.width
    // let queryFingerprint = req.queryFingerprint
    // let ext = req.image.ext
    // let mime = req.image.mime
    // let discovery = await arc.services()
    // let s3 = new aws.S3({ Region })

    // let buffer
    // let env = process.env.ARC_ENV || process.env.NODE_ENV
    // let isLive = (env === 'staging' || env === 'production')

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

      let size = sizeOf(buffer)
      let scaling = Math.min(width / size.width, height / size.height)
      let newWidth  = scaling * size.width
      let newHeight = scaling * size.height

      let image = await Jimp.read(buffer)
      image.resize(newWidth, newHeight)
      let output = await image.getBufferAsync(Jimp.AUTO)
      if (isLive) {
      // let cacheBucket = discovery['storage-private']['image-cache']
        await s3.putObject({
          ContentType: mime,
          Bucket: cacheBucket,
          Key,
          Body: output,
        }).promise()
      }
      else {
      // fs.mkdirSync('../../../tmp-cache', { recursive: true })
      // fs.writeFileSync(path.resolve('../../../tmp-cache/', Key), output)
        fs.writeFileSync(path.resolve(cacheBucket, Key), output)
      }

      // 4. respond with the image
      return {
        statusCode: 200,
        headers: { 'content-type': mime, isBase64Encoded: true },
        body: output.toString('base64')
      }
    }
    else {
      return { statusCode: 404 }
    }
  } 

}

