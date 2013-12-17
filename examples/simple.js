var couch = process.argv[2];

if (!couch) {
  return console.log('Please give me a database url!');
}

var es = require('event-stream');

es.pipeline(
  require('..')(couch),
  es.stringify(),
  process.stdout
);
