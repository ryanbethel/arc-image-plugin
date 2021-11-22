let arc = require('@architect/functions')
let { imageHandler } = require('@ryanbethel/arc-image-plugin')

exports.handler = arc.http.async(imageHandler)
