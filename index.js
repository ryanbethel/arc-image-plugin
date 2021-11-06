let path = require('path')


function package ({ arc, cloudformation }) {


  // let appName = arc.app
  // let transformSrc = path.resolve(__dirname, './src')

  // if (cloudformation.Resources.HTTP.paths['/transform/{proxy+}']) {

  //   cloudformation.Resources.HTTP.paths['/transform/{proxy+}'] = {
  //     'get': {
  //       'x-amazon-apigateway-integration': {
  //         'payloadFormatVersion': '2.0',
  //         'type': 'aws_proxy',
  //         'httpMethod': 'POST',
  //         'uri': {
  //           'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetTransformCatchallHTTPLambda.Arn}/invocations'
  //         },
  //         'connectionType': 'INTERNET'
  //       }
  //     }
  //   }


  //   cloudformation.Resources['GetTransformCatchallHTTPLambda'] = {
  //     'Type': 'AWS::Serverless::Function',
  //     'Properties': {
  //       'Handler': 'index.handler',
  //       'CodeUri': transformSrc,
  //       'Runtime': 'nodejs12.x',
  //       'Architectures': [
  //         'x86_64'
  //       ],
  //       'MemorySize': 1152,
  //       'Timeout': 30,
  //       'Environment': {
  //         'Variables': {
  //           'ARC_APP_NAME': appName,
  //           'ARC_CLOUDFORMATION': {
  //             'Ref': 'AWS::StackName'
  //           },
  //           'ARC_ENV': stage,
  //           'ARC_ROLE': {
  //             'Ref': 'Role'
  //           },
  //           'NODE_ENV': stage,
  //           'SESSION_TABLE_NAME': 'jwe',
  //           'ARC_STATIC_BUCKET': {
  //             'Ref': 'StaticBucket'
  //           },
  //           'ARC_STORAGE_PRIVATE_IMAGE_CACHE': {
  //             'Ref': 'ImageCacheBucket'
  //           }
  //         }
  //       },
  //       'Role': {
  //         'Fn::Sub': [
  //           'arn:aws:iam::${AWS::AccountId}:role/${roleName}',
  //           {
  //             'roleName': {
  //               'Ref': 'Role'
  //             }
  //           }
  //         ]
  //       },
  //       'Events': {
  //         'GetTransformCatchallHTTPEvent': {
  //           'Type': 'HttpApi',
  //           'Properties': {
  //             'Path': '/transform/{proxy+}',
  //             'Method': 'GET',
  //             'ApiId': {
  //               'Ref': 'HTTP'
  //             }
  //           }
  //         }
  //       },
  //     }
  //   }


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
}

let os = require('os')
let fs = require('fs')
let sandbox = {
  start: function ( { arc, inventory, services },  callback) {
    console.log('in variables')
    console.log(inventory)
    callback()
  }
}
function variables  ({ arc, cloudformation, stage, inventory }) {
  const isLocal = stage === 'testing' // stage will equal 'testing' when running in sandbox, otherwise will be one of 'staging' or 'production' when running in a `deploy` context
  let cacheBucket
  let staticDir
  if (isLocal) {
    cacheBucket = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-img-cache'))
    staticDir = inventory.inv._project.src + '/' + inventory.inv.static.folder

    return { cacheBucket, staticDir }
  }
  else return { cacheBucket: { 'Ref': 'ImageCacheBucket' } }
}




let arc = require('@architect/functions')
let Jimp = require('jimp')
let sizeOf = require('image-size')
let aws = require('aws-sdk')
// let fs = require('fs')
// let path = require('path')
let { createHash } = require('crypto')

async function imageHandler (req){
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

module.exports = { package, sandbox, variables,  imageHandler }
