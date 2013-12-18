var couch = process.argv[2];

if (!couch) {
  return console.log('Please give me a database url!');
}

var es = require('event-stream');

es.pipeline(
  require('..')(couch),
  es.map(function(data, done) {
    done(null, data.response);
  }),
  es.stringify(),
  process.stdout
);
