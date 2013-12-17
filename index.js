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
// TODO: this should be sandboxed
function evalFilter(code) {
  var filter;

  eval('filter = ' + code);

  return filter;
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

    var filters = resp.rows.map(function(row) {
        return row.doc.couchmagick.filter;
      }).filter(function(code) {
        return code;
      }).map(evalFilter);

    var config = {
      filter: function(doc) {
        return !filters.filter(function(filter) {
          return !filter(doc);
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

    Object.keys(config.versions).forEach(function(name) {
      var version = config.versions[name];

      if (version.filter) {
        version.filter = evalFilter(version.filter);
      }
    });

    done(null, config);
  });
}


module.exports = function couchmagick(url, options) {
  options = options || {};
  options.include_docs = true;

  var config = {};

  es.pipeline(
    es.readArray([1]),

    es.through(function() {
      var db = nano(url);
      var queue = this.queue;

      getConfig(db, function(err, data) {
        if (err || !data) {
          return queue(null);
        }

        util._extend(config, data);

        db.changes(options).on('data', queue);
      });
    }, noop),

    JSONStream.parse('results.*.doc'),

    magick(url, config),

    es.stringify(),

    process.stdout
  );
};
