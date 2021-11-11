# An Architect plugin for transforming images

## What it does

Drop large images in the static folder of an Architect app and request a transformed version. 


## How to Install it

You can install the plugin for any Architect app with `npm install` `@ryanbethel/arc-image-plugin`. You can then add it to your app manifest like this:

```arc
#app.arc
@app
image-app

@http
get /
get /transform/*  #transform route for arc-image-plugin

@plugins
ryanbethel/arc-image-plugin
```

Currently, you need to add the `get /transform/*` in line 6 to register a route for the handler. In the future, this will be rolled into the plugin. You also need to add the handler itself and the config file below for the same reason. Again will this will be added into the plugin in a future version. 

```javascript
// src/http/get-transform-catchall/index.js
let arc = require('@architect/functions')
let { imageHandler } = require('@ryanbethel/arc-image-plugin')

exports.handler = arc.http.async(imageHandler)
```

```arc
#src/http/get-transform-catchall/config.arc
@aws
memory 1152
timeout 30
```

## How to use it

The Architect framework serves static assets from a local folder that becomes an S3 bucket when deployed to AWS. You drop your `giant.jpeg` image in the `public` folder, and then once deployed, you can access it from anywhere in your app at `http://example.com/_static/giant.jpeg` or with a root relative path at `/_static/giant.jpeg`. Architect includes built in fingerprinting of assets as a best practice, but we will ignore that for the moment for clarity. With the image plugin, you can request the same image by swapping the “_static” for “transform” and include query parameters to get a different size (`/transform/giant.jpeg?width=100&height=100`). This will scale the image to fit in those dimensions while maintaining the aspect ratio. 


![Image transform flowchart](https://www.dropbox.com/s/7g31zg0nwbjnhwm/arc-image-plugin.drawio.png?raw=1)


The first time you make a request, it is transformed in a lambda and that new version is saved to an S3 bucket. The next request for that size is served from the cache. Scale to fit, cover, and contain transforms are supported as well as grayscale. 

Local Development

One of the most valuable features of using Architect is that it has local development support for almost everything. I built this plugin to have the same. It uses a local temp directory as a cache for transformed images and it works as it would when deployed. 
