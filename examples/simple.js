var couch = process.argv[2];

if (!couch) {
  return console.log('Please give me a database url!');
}

require('..')(couch);
