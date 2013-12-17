couchmagick-listen
============
Stream changes to couchmagick-stream.

Usage
-----
Create a design document with a couchmagick configuration:
```json
{
  "_id": "_design/my-couchmagick-config",
  "_rev": "1-a653b27246b01cf9204fa9f5dee7cc64",
  "couchmagick": {
    "filter": "function(doc) { return doc.type === 'post'; }",
    "versions": {
      "thumbnail": {
        "filter": "function(doc, name) { return doc.display && doc.display.indexOf('overview') > -1; }",
        "format": "jpg",
        "id": "{id}/thumbnail",
        "name": "{basename}-thumbnail.jpg",
        "args": [
          "-",
          "-resize", "x100",
          "-quality", "75",
          "-colorspace", "sRGB",
          "-strip",
          "jpg:-"
        ]
      }
    }
  }
}
```
See [couchmagick-stream](https://github.com/null2/couchmagick-stream) for available options;

Listen for changes:
```js
require('couchmagick-listen')('http://localhost:5984/mydb');
```

Configuration
-------------
couchmagick-listen accepts an options object as second parameter, which will get
passed to
[nano's changes](https://github.com/dscape/nano#nanodbchangesname-params-callback).

Examples
--------
You can run an example (`examples/simple.js`):
```bash
node examples/simple.js http://localhost:5984/mydb
```

Contributing
------------
Lint your code with `npm run jshint`

(c) 2013 Johannes J. Schmidt, null2 GmbH
