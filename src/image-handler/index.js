const path = require('path')
const fs = require('fs')
const arc = require('@architect/functions')
const Jimp = require('jimp')
const aws = require('aws-sdk')
const { createHash } = require('crypto')
const normalizedStringify = require('json-stable-stringify')
const env = process.env.ARC_ENV || process.env.NODE_ENV
const isLive = (env === 'staging' || env === 'production')
const Region = process.env.AWS_REGION
const discovery = arc.services() // returns a promise, await in handler
const fourOhFour = { statusCode: 404 }
const staticDir = process.env.ARC_STATIC_BUCKET
let discovered, cacheBucket


function antiCache ({ mime }) {
  return {
    'cache-control': 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
    'accept-ranges': 'bytes',
    'content-type': `${mime}; charset=utf8`,
  }
}
function longCache ({ mime }) {
  return  {
    'cache-control': 'max-age=31536000',
    'content-type': `${mime}; charset=utf8`,
  }
}
function imageResponse ({ mime, buffer }){
  let fingerprint = isLive ? discovered.static.fingerprint : process.env.ARC_IMAGE_PLUGIN_FINGERPRINT
  return { statusCode: 200,
    headers: fingerprint ? longCache({ mime }) : antiCache({ mime }),
    isBase64Encoded: true,
    body: buffer.toString('base64')
  }
}


module.exports = {
  handler: async function (req){
    discovered = await discovery
    cacheBucket = isLive ?  discovered.services['arc-image-plugin-cache-bucket'] : process.env.ARC_IMAGE_PLUGIN_LOCAL_CACHE

    // Validate request parameters
    let rawPath = req.rawPath
    let imagePath = rawPath.replace(/_static\//i, '').replace(/^\/transform\//i, '')
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
        exists = false
      }
    }

    if (exists) {
      return imageResponse({ mime, buffer })
    }

    // Transform
    // 1. first get the original image
    exists = true
    if (isLive) {
    // read from s3
      let Bucket = staticDir
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
      let pathToStatic = staticDir
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
      return imageResponse({ mime, buffer: output })
    }
    else {
      return fourOhFour
    }

  }

}

