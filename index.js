/* couchmagick-listen
 * (c) 2013 Johannes J. Schmidt, null2 GmbH, Berlin 
 */

var util = require('util');
var es = require('event-stream');
var nano = require('nano');
var JSONStream = require('JSONStream');
var magick = require('couchmagick-stream');

var noop = function() {};


/*jshint evil: true */
function evalFilter(code) {
  return eval('(function() { return ' + code + '})()');
}

// Get configuration from design documents:
// - merge multiple configurations
// - evaluate filters
// - combile filters
function getConfig(db, done) {
  db.list({
    startkey: '_design',
    endkey: '_design0',
    include_docs: true
  }, function(err, resp) {
    if (err) {
      return done(err);
    }
    if (!resp.rows.length) {
      return done(null, null);
    }

    var docs = resp.rows
      .filter(function(row) { return typeof row.doc.couchmagick === 'object'; })
      .map(function(row) { return row.doc; });

    if (!docs.length) {
      return done(null, null);
    }


    // eval filters
    docs.forEach(function(doc) {
      // toplevel filter
      if (doc.couchmagick.filter) {
        doc.couchmagick.filter = evalFilter(doc.couchmagick.filter);
      }

      // version filters
      Object.keys(doc.couchmagick.versions).forEach(function(name) {
        var version = doc.couchmagick.versions[name];

        if (version.filter) {
          version.filter = evalFilter(version.filter);
        }
      });
    });


    var config = docs.reduce(function(memo, doc) {
      memo[doc._id] = doc.couchmagick;

      return memo;
    }, {});


    done(null, config);
  });
}


module.exports = function couchmagick(url, options) {
  options = options || {};

  var config = {};
  var db = nano(url);
  var statusDoc = {
    _id: '_local/couchmagick',
    last_seq: 0
  };
  var lastSeq;

  var changesParserOptions = options.feed === 'continuous' ? null : 'results.*';

  var changesOptions = {
    include_docs: true
  };

  if (options.feed) {
    changesOptions.feed = options.feed;
  }
  if (options.limit) {
    changesOptions.limit = options.limit;
  }
  if (options.changes_feed_timeout) {
    changesOptions.timeout = options.changes_feed_timeout;
  }


  function storeCheckpoint(seq) {
    if (statusDoc.last_seq === seq) {
      return;
    }

    statusDoc.last_seq = seq;
    db.head(statusDoc._id, function(err, _, headers) {
      if (!err && headers && headers.etag) {
        statusDoc._rev = JSON.parse(headers.etag);
      }
      db.insert(statusDoc, statusDoc._id);
    });
  }

  return es.pipeline(
    // kick off
    es.readArray([1]),

    // get config
    es.through(function write() {
      var queue = this.queue;

      // get configuration
      getConfig(db, function(err, data) {
        if (err || !data) {
          return queue(null);
        }

        util._extend(config, data);

        // request status doc
        db.get(statusDoc._id, function(err, doc) {
          util._extend(statusDoc, doc || {});

          changesOptions.since = statusDoc.last_seq;

          es.pipeline(
            // listen to changes
            db.changes(changesOptions)
              .on('data', queue)
              .on('end', function() {
                queue(null);
              }),

            // parse last seq
            JSONStream.parse('last_seq'),

            // store lastSeq
            es.map(function(data, done) {
              lastSeq = data;
              done(null, data);
            })
          );
        });
      });
    }, noop),

    // parse changes feed
    JSONStream.parse(changesParserOptions),

    // run through magick
    magick(url, config, options)
      // store checkpoint after completed
      .on('completed', function(data) {
        storeCheckpoint(data.seq);
      })
  )
  // store checkpoint at the end
  .on('end', function() {
    if (lastSeq) {
      storeCheckpoint(lastSeq);
    }
  });
};
