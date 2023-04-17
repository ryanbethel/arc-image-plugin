@app
plug-img-example

@static
fingerprint true

@http
get /

@plugins
enhance/arc-image-plugin
enhance/arc-plugin-enhance

@aws
profile begin-examples
region us-east-1
runtime nodejs16.x

  

@begin
appID SLCG8B5Q
