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
const imageCacheFolderName = ".image-transform-cache"

const Vips = require('wasm-vips')
const vips = await Vips()

const { ImagePool } = require('@squoosh/lib')
const imagePool = new ImagePool()


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
    console.log("in tranform handler")
    discovered = await discovery
    cacheBucket = isLive ? staticDir : process.env.ARC_IMAGE_PLUGIN_LOCAL_CACHE

    // Validate request parameters
    let rawPath = req.rawPath
    let imagePath = rawPath.replace(/_static\//i, '').replace(/_public\//i, '').replace(/^\/transform\//i, '')
    let query = req.queryStringParameters

    let allowedParams = {
      width: query?.width,
      height: query?.height,
      // grayscale: query?.grayscale,
      quality: query?.quality,
      // scaleToFit: query?.scaleToFit,
      // cover: query?.cover,
      // contain: query?.contain,
      format: query?.format,
      focus: query?.focus
    }

    const imageFormats = {
      jpeg: {extOut:'jpeg', encoder:'mozjpeg', mime: 'image/jpeg'},
      jpg: {extOut:'jpeg', encoder:'mozjpeg', mime: 'image/jpeg'},
      png: {extOut:'png', encoder:'oxipng', mime: 'image/png'},
      avif: {extOut:'avif', encoder:'avif', mime: 'image/avif'},
      webp: {extOut:'webp', encoder:'webp', mime: 'image/webp'},
    }


    let hash = createHash('sha256')
    hash.update(`${imagePath}:${normalizedStringify(allowedParams)}`)
    let queryFingerprint =  hash.digest('hex').slice(0, 10)
    let ext = path.extname(imagePath).slice(1)
    let extOut = imageFormats?.[allowedParams.format]?.extOut || imageFormats[ext].extOut
    if (!extOut) return fourOhFour
    let mime = imageFormats[extOut].mime

    // check cache
    let s3 = new aws.S3({ Region })

    let buffer

    let exists = true
    if (isLive) {
    // read from s3
      let Bucket = cacheBucket
      let Key = `${imageCacheFolderName}/${queryFingerprint}.${extOut}`
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
      let pathToFile = path.join(cacheBucket, `${imageCacheFolderName}/${queryFingerprint}.${extOut}`)
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
      let Key = imagePath
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
      console.log(pathToFile)
      try {
        buffer = fs.readFileSync(pathToFile)
      }
      catch (e){
        exists = false
        try {
          exists = true
          buffer = fs.readFileSync(pathToFile)
        }
        catch (e){
          exists = false
        }
      }
    }


    // 2. transform it
    if (exists){
      let Key = `${imageCacheFolderName}/${queryFingerprint}.${extOut}`
      let imageJimp = await Jimp.read(buffer)
      let height = allowedParams.height ? Number.parseInt(allowedParams.height) : Jimp.AUTO
      let width = allowedParams.width ? Number.parseInt(allowedParams.width) : Jimp.AUTO
      if (allowedParams.height && allowedParams.width) {
        imageJimp.cover(width, height)
      }
      else {
        imageJimp.resize(width, height)
      }
      firstPass = await imageJimp.getBufferAsync(Jimp.AUTO)
      
      let image = imagePool.ingestImage(firstPass)
      await image.decoded
      const codec = imageFormats[extOut].encoder
      let preprocessorOptions = {}
      let encodeOptions = {[codec]:{}}

      if (allowedParams.quality) encodeOptions[codec].quality = Number.parseInt(allowedParams.quality)

      await image.preprocess(preprocessorOptions)

      await image.encode(encodeOptions)


      // save to cache
      let encodedImage = await image.encodedWith[imageFormats[extOut].encoder]
      let output = encodedImage.binary
      if (isLive) {
        await s3.putObject({
          ContentType: mime,
          Bucket: cacheBucket,
          Key,
          Body: output,
        }).promise()
      }
      else {
        if(!fs.existsSync(`${cacheBucket}/${imageCacheFolderName}`)) fs.mkdirSync(`${cacheBucket}/${imageCacheFolderName}`)
        fs.writeFileSync(path.resolve(cacheBucket, Key), output)
      }

      // 4. respond with the image
      return imageResponse({ mime, buffer: Buffer.from(output)})
    }
    else {
      return fourOhFour
    }

  }

}

