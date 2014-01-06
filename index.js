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

    var rows = resp.rows.filter(function(row) {
      return typeof row.doc.couchmagick === 'object';
    });

    if (!rows.length) {
      return done(null, null);
    }

    // eval filters
    resp.rows.forEach(function(row) {
      // toplevel filter
      if (row.doc.couchmagick.filter) {
        row.doc.couchmagick.filter = evalFilter(row.doc.couchmagick.filter);
      }

      // version filters
      Object.keys(row.doc.couchmagick.versions).forEach(function(name) {
        var version = row.doc.couchmagick.versions[name];

        if (version.filter) {
          version.filter = evalFilter(version.filter);
        }

        if (!version.filter && row.doc.couchmagick.filter) {
          version.filter = row.doc.couchmagick.filter;
        }
      });
    });

    var filters = resp.rows.map(function(row) {
        return row.doc.couchmagick.filter;
      }).filter(function(code) {
        return code;
      });

    var config = {
      // OR filters
      filter: function(doc) {
        return filters.filter(function(filter) {
          return filter(doc);
        }).length;
      },
      versions: rows.reduce(function(memo, row) {
        if (row.doc.couchmagick.versions) {
          Object.keys(row.doc.couchmagick.versions).forEach(function(version) {
            memo[version] = row.doc.couchmagick.versions[version];
          });
        }

        return memo;
      }, {})
    };

    done(null, config);
  });
}


module.exports = function couchmagick(url, options) {
  options = options || {};
  options.include_docs = true;

  var db = nano(url);
  var config = {};
  var statusDoc = {
    _id: '_local/couchmagick',
    last_seq: 0
  };
  var lastSeq;

  var changesParserOptions = options.feed === 'continuous' ? null : 'results.*';

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

          options.since = statusDoc.last_seq;

          es.pipeline(
            // listen to changes
            db.changes(options)
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
    magick(url, config)
      // store checkpoint after completed
      .on('completed', function(data) {
        storeCheckpoint(data.seq);
      })
  )
  // store checkpoint at the end
  .on('end', function(data) {
    if (lastSeq) {
      storeCheckpoint(lastSeq);
    }
  });
};
