let arc = require('@architect/functions')
let { imageHandler } = require('arc-image-plugin')

exports.handler = arc.http.async(imageHandler)
