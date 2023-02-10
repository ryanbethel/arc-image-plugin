const path = require('path')
const fs = require('fs')
const arc = require('@architect/functions')
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
    cacheBucket = isLive ? staticDir : process.env.ARC_IMAGE_PLUGIN_LOCAL_CACHE

    // Validate request parameters
    let rawPath = req.rawPath
    let imagePath = rawPath.replace(/_static\//i, '').replace(/_public\//i, '').replace(/^\/transform\//i, '')
    let query = req.queryStringParameters

    let allowedParams = {
      width: query?.width, // in pixels
      height: query?.height,  // in pixels
      quality: query?.quality, // 0 to 100
      format: query?.format, // output file format
      fit: query?.fit, // cover or contain
      focus: query?.focus, // top, right, bottom, left, top-right, bottom-right, bottom-left, top-left
      mark: query?.mark !== undefined ? true : false,
      x: query?.x,
      y: query?.y,

    }

    const imageFormats = {
      jpeg: {extOut:'jpeg', mime: 'image/jpeg'},
      jpg: {extOut:'jpeg', mime: 'image/jpeg'},
      png: {extOut:'png', mime: 'image/png'},
      avif: {extOut:'avif', mime: 'image/avif'},
      webp: {extOut:'webp', mime: 'image/webp'},
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
      let pathToStatic = staticDir
      let pathToFile = path.join(pathToStatic, imagePath)
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
      const vips = await Vips()
      let Key = `${imageCacheFolderName}/${queryFingerprint}.${extOut}`
      let image = vips.Image.newFromBuffer(buffer)

      const heightIn = image.height
      const widthIn = image.width

      const heightOut = allowedParams.height ? Number.parseInt(allowedParams.height) : 0
      const widthOut = allowedParams.width ? Number.parseInt(allowedParams.width) : 0
      
      const aspectIn = widthIn/heightIn
      const aspectOut = (heightOut && widthOut) ? widthOut/heightOut : aspectIn

      const heightScale = heightOut ? heightOut/heightIn : widthOut/widthIn
      const widthScale = widthOut ? widthOut/widthIn : heightOut/heightIn 


      let xPercent = 50
      let yPercent = 50
      if (allowedParams.x) xPercent = allowedParams.x ? Number.parseInt(allowedParams.x) : 50
      if (allowedParams.y) yPercent = allowedParams.y ? Number.parseInt(allowedParams.y) : 50

      if (allowedParams.mark) {
        // let marker = vips.Image.newFromFile('./marker.png')
        // const config = {
        //   x: Math.round((xPercent/100)*(image.width-marker.width/2)),
        //   y: Math.round((yPercent/100)*(image.height-marker.height/2)),
        // }
        // image = image.composite(marker, vips.BlendMode.over, config);
        const x = Math.round((xPercent/100)*(widthIn))
        const y = Math.round((yPercent/100)*(heightIn))
        const radius = Math.round(widthIn/10)
        // image.drawCircle([255,255,255],1000,1000,50)
        image.drawCircle([0,0,0],x,y,radius)
      }

      const fit = allowedParams.fit ? allowedParams.fit : 'contain'
      const focus = allowedParams.focus ? allowedParams.focus : 'top'

      if (fit==='contain') image = image.resize(Math.min(heightScale,widthScale));
      if (fit==='cover') {
        image = image.resize(Math.max(heightScale,widthScale))
        const heightInter = image.height
        const widthInter = image.width
        let cropStart = {left:0, top:0}
        switch (focus) {
          case 'top':
            cropStart.left=Math.round((widthInter-widthOut)/2)
            cropStart.top=0
            break;
          case 'right':
            cropStart.left=(widthInter-widthOut)
            cropStart.top=Math.round((heightInter-heightOut)/2)
            break;
          case 'bottom':
            cropStart.left=Math.round((widthInter-widthOut)/2)
            cropStart.top=(heightInter-heightOut)
            break;
          case 'left':
            cropStart.left=0
            cropStart.top=Math.round((heightInter-heightOut)/2)
            break;
          case 'top-right':
            cropStart.left=(widthInter-widthOut)
            cropStart.top=0
            break;
          case 'bottom-right':
            cropStart.left=(widthInter-widthOut)
            cropStart.top=(heightInter-heightOut)
            break;
          case 'bottom-left':
            cropStart.left=0
            cropStart.top=(heightInter-heightOut)
            break;
          case 'top-left':
            cropStart.left=0
            cropStart.top=0
            break;
          case 'center':
            cropStart.left=Math.round((widthInter-widthOut)/2)
            cropStart.top=Math.round((heightInter-heightOut)/2)
            break;
          case 'point':
            cropStart.left=Math.max(Math.min((widthInter-widthOut), Math.round((widthInter*(xPercent/100))-widthOut/2)),0)
            cropStart.top=Math.max(Math.min((heightInter-heightOut), Math.round((heightInter*(yPercent/100))-heightOut/2)),0)
            break;
          default:
            cropStart.left=Math.round((widthInter-widthOut)/2)
            cropStart.top=Math.round((heightInter-heightOut)/2)
            break;
        }

        image = image.crop(cropStart.left,cropStart.top,widthOut,heightOut)

      }


      let options = {}
      if (allowedParams.quality) options.Q = allowedParams.quality
      let output = image.writeToBuffer('.'+extOut,options)

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

