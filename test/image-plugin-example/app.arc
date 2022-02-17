@app
plug-img-expl

@static
fingerprint true

@http
get /

@plugins
ryanbethel/arc-image-plugin

@aws
profile begin-examples
region us-east-1
  
