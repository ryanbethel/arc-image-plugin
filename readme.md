# An Architect plugin for transforming images

## What it does

Drop large images in the static folder of an Architect app and request a transformed version. 


## Install

You can install the plugin for any Architect app with `npm install @enhance/arc-image-plugin`. You can then add it to your app manifest like this:

```arc
#app.arc
@app
image-app

@plugins
enhance/arc-image-plugin
```

## Use

The Architect framework serves static assets from a local folder that becomes an S3 bucket when deployed to AWS. 
You drop your `giant.jpeg` image in the `public` folder, and then once deployed, you can access it from anywhere.
In your app you can request `http://example.com/_static/giant.jpeg` or with a root relative path at `/_public/giant.jpeg`. 
Architect includes built in fingerprinting of assets as a best practice, but we will ignore that for the moment for clarity. 
With the image plugin, you can request the same image by swapping the “_static” for “transform” and include query parameters to get a different size (`/transform/giant.jpeg?width=100&height=100`). 
This will scale the image to fit in those dimensions while maintaining the aspect ratio. 

Other examples:
- /transform/_public/elephant.jpg?format=avif&width=100&quality=50
- /transform/_public/elephant.png?format=webp&width=100&height=500

The transformation will always maintain aspect ratio unless specifically overridden with parameters.

If both a height and width are specified the most constrained dimention will control the output.

If the image format supports quality it can be specified. 

Supported input formats are png, jpg, and gif. Supported outputs are all the inputs formats plus avif and webp additionally. 



![Image transform flowchart](https://www.dropbox.com/s/7g31zg0nwbjnhwm/arc-image-plugin.drawio.png?raw=1)


The first time you make a request, it is transformed in a lambda and that new version is saved to an S3 bucket. 
The next request for that size is served from the cache. 
Scale to fit, cover, and contain transforms are supported as well as grayscale. 


