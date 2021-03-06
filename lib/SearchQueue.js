
var fbutil = require('./fbutil'),
   logger = require('./logging').logger;

function SearchQueue(esc, reqRef, resRef, cleanupInterval) {
  this.esc = esc;
  this.inRef = reqRef;
  this.outRef = resRef;
  this.cleanupInterval = cleanupInterval;
  logger.info('Queue started, IN: "%s", OUT: "%s"', fbutil.pathName(this.inRef), fbutil.pathName(this.outRef));
  setTimeout(function() {
    this.inRef.on('child_added', this._process.bind(this), this);
  }.bind(this), 1000);
  this._nextInterval();
}

SearchQueue.prototype = {
  _process: function(snap) {
    var dat = snap.val();
    var self = this;
    if( this._assertValidSearch(snap.key(), snap.val()) ) {
      // structure jquery into JSON object format expected by elasticsearch
      var queryObj = this._isJson(dat.query) ? JSON.parse(dat.query) : dat.query;
      queryObj = queryObj.hasOwnProperty('query') ? queryObj : { "query": queryObj };

      this.esc.search({
        index: dat.index, 
        type: dat.type, 
        body: queryObj
      }).then( function(rsp) {
        logger.debug('search result', rsp);
        self._reply(snap.key(), rsp);
      }).catch( function(err) {
        logger.error(err);
        self._reply(snap.key(), {error: err, total: 0});
      });

    }
  },
  
  _reply: function(key, results) {
    if( results.error ) {
      this._replyError(key, results.error);
    }
    else {
      logger.debug('result %s: %d hits', key, results.hits.total);
      this._send(key, results);
    }
  },
  
  _assertValidSearch: function(key, props) {
    var res = true;
    if( typeof(props) !== 'object' || !props.index || !props.type || !props.query ) {
      this._replyError(key, 'search request must be a valid object with keys index, type, and query');
    }
    return res;
  },
  
  _replyError: function(key, err) {
    this._send(key, { total: 0, error: err });
  },
  
  _send: function(key, data) {
    this.inRef.child(key).remove(this._abortOnWriteError.bind(this));
    this.outRef.child(key).setWithPriority(data, new Date().valueOf());
  },
  
  _abortOnWriteError: function(err) {
    if( err ) {
      logger.warning((err+'').red);
      throw new Error('Unable to remove queue item, probably a security error? '+err);
    }
  },
  
  _housekeeping: function() {
    var self = this;
    // remove all responses every CHECK_INTERVAL milliseconds
    this.outRef.set(null).then(function(rsp) {
      logger.info("housekeeping: Performed maintenance, nuking all stale responses older than " 
                  + self.cleanupInterval/1000 + " seconds.");
    }).catch(function(err) {
      logger.error("housekeeping: Mainenance failed: " + err);
    }).finally(function() {
      self._nextInterval();
    });
  },
  
  _nextInterval: function() {
    var interval = this.cleanupInterval > 60000? 'minutes' : 'seconds';
    logger.info('Next cleanup in %d %s', Math.round(this.cleanupInterval/(interval==='seconds'? 1000 : 60000)), interval);
    setTimeout(this._housekeeping.bind(this), this.cleanupInterval);
  },

   _isJson: function() {
       try {
           JSON.parse(str);
       } catch (e) {
           return false;
       }
       return true;
   }
};

exports.init = function(esc, reqRef, resRef, cleanupInterval) {
  new SearchQueue(esc, reqRef, resRef, cleanupInterval);
};
