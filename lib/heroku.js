var https  = require('https'),
    tls    = require('tls'),
    qs     = require('querystring'),
    EventEmitter = require('events').EventEmitter;

var HEROKU_API_HOST = "api.heroku.com";

exports.createClient = createClient;

function createClient(key) {
  var client = Object.create(methods);
  client.key = key;
  client.auth = 'Basic ' + new Buffer(':' + key).toString('base64');
  return client;
}


var methods = {
  getApps: function (callback) {
    jsonGetRequest('/apps', this.auth, callback || console.log);
  },

  getProcesses: function (appName, callback) {
    jsonGetRequest('/apps/' + appName + '/ps', this.auth, callback || console.log);
  },

  logStream: function (appName, options) {
    var self = this;

    options = options || {};
    options.logplex = "true";

    var queryObj = {
      logplex: "true",
      num: options.num || 0,
    };

    if (options.ps) {
      queryObj.ps = options.ps;
    }

    if (options.source) {
      queryObj.source = options.source;
    }

    if (options.tail) {
      queryObj.tail = 1;
    }


    var reconnect = options.reconnect || false;
    var query = qs.stringify(options);
    var stream = new EventEmitter();

    herokuGetRequest('/apps/' + appName + '/logs?' + query, this.auth, function (err, url) {
      if (err) {
        stream.emit('error', err);
        return;
      }

      var parts = url.split('com'),
          host = parts[0].replace('https://', '') + 'com',
          path = parts[1];

      var socket = tls.connect(443, host, function () {
        socket.write('GET ' + path + ' HTTP/1.1\r\n' +
                     'host: logplex.heroku.com\r\n\r\n');

        socket.setEncoding('utf8');

        socket.on('connect', function () {
          stream.emit('connect');
        });

        socket.on('data', function (data) {
          var lines = data.split('\n');
          lines.forEach(function (line) {
            stream.emit('line', line);
          });
        });

        var destroyAndReconnect = function () {
          socket.destroy();
          stream.emit('disconnect');

          if (reconnect) {
            self.logStream(appName, options);
          }
        }

        socket.on('end', function () {
          console.log('Socket End');
          destroyAndReconnect();
        });

        socket.on('close', function () {
          console.log('Socket Close');
          destroyAndReconnect();
        });

        socket.on('timeout', function () {
          console.log('Socket Timeout');
          destroyAndReconnect();
        });

        socket.on('error', function () {
          console.log('Socket Error');
          destroyAndReconnect();
        });
      });
    });

    return stream;
  }
};



function herokuGetRequest(url, auth, headers, callback) {
  if (typeof headers == 'function') {
    callback = headers;
    headers = {};
  }

  headers.authorization = auth;
  headers.accept = headers.accept || 'application/json';

  var req = https.get({
    host: HEROKU_API_HOST,
    path: url,

    headers: headers
  }, function (res) {
    var buffer = '';

    res.on('data', function (data) {
      buffer += data.toString();
    });

    res.on('end', function () {
      if (res.statusCode >= 200 && res.statusCode <= 299) {
        callback(null, buffer);

      } else {
        var error = new Error(buffer);
        error.statusCode = res.statusCode;

        callback(error);
      }
    });

    res.on('err', function () {
      callback(err);
    });
  });

  req.on('error', function (err) {
    callback(err);
    callback = function () {};
  });
}

function jsonGetRequest(url, auth, callback) {
  herokuGetRequest(url, auth, {}, function (err, response) {
    if (err) return callback(err);

    try {
      var json = JSON.parse(response);
      callback(null, json);
    } catch (e) {
      callback(e);
    }
  });
}
