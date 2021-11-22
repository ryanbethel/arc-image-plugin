@app
plug-img-expl

@static
fingerprint true

@http
get /
get /transform/*


@plugins
ryanbethel/arc-image-plugin

@aws
profile begin-examples
region us-east-1
  
