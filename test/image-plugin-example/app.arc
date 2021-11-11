@app
plug-img-expl

@static
fingerprint true

@http
get /
get /transform/*


@plugins
arc-image-plugin

@aws
profile begin-examples
region us-east-1
  
