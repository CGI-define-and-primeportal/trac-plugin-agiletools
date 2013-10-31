// TASKBOARD PUBLIC CLASS DEFINITION
// =================================
var LiveUpdater = Class.extend({

  init_updates: function(refreshInterval, fullRefreshN) {
    var _this = this;
    this.updateCount = 0;
    this.refreshInterval = refreshInterval || 5; // In seconds
    this.fullRefreshN = fullRefreshN || 120;
    this.lastUpdate = this.iso_8601_datetime(new Date());
    this.upInterval = setInterval(function() {
      _this.updateCount ++;
      // Do a complete refresh every 10 mins
      if(_this.updateCount % _this.fullRefreshN === 0) {
        _this.refresh(true);
      }
      else {
        _this.get_updates();
      }
    }, _this.refreshInterval * 1000);
  },

  get_updates: function() {
    var _this = this,
        now = this.iso_8601_datetime(new Date());
    $.ajax({
      data: {
        'from': this.lastUpdate,
        'to': now
      },
      success:function(data, textStatus, jqXHR) {
        _this.process_update(data);
        _this.lastUpdate = now;
      }
    });
  },

  iso_8601_datetime: function(date) {
    function pad(n) { return n < 10 ? '0' + n : n; }
    return date.getUTCFullYear() + '-' +
        pad(date.getUTCMonth() + 1) + '-' +
        pad(date.getUTCDate()) + 'T' +
        pad(date.getUTCHours()) + ':' +
        pad(date.getUTCMinutes()) + ':' +
        pad(date.getUTCSeconds()) + 'Z';
  },

  // Replace with unique process event
  process_update: function(data) {
  },

  // Replace with unique complete refresh
  refresh: function() {
  }

});