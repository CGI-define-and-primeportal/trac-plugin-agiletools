(function($) {

  // TASKBOARD PUBLIC CLASS DEFINITION
  // =================================
  $.LiveUpdater = Class.extend({

    init_updates: function(opts) {
      var _this = this;

      opts = opts || {};

      this.updateCount = 0;
      this.interval = (opts.interval || 5) * 1000;
      this.fullRefreshAfter = opts.fullRefreshAfter || 120;
      this.updateData = opts.data || {};

      this.lastUpdate = this.iso_8601_datetime(new Date());
      this._queue_update();
    },

    _get_updates: function() {
      this.updateCount ++;

      // Full refresh: We don't know how to deal with an unsuccessful refresh,
      // This should be implemented by the user of LiveUpdater, as it may involve
      // a full page refresh e.g.
      if(this.updateCount % this.fullRefreshAfter === 0) {
        $.when(this.refresh())
          .then($.proxy(this, "_queue_update"));
      }

      // Standard update: by default a request for changes between two times
      else {
        $.when(this.get_update())
          .then($.proxy(this, "process_update"),
                $.proxy(this, "process_update_fail"))
          .always($.proxy(this, "_queue_update"));
      }
    },

    _queue_update: function() {
      var _this = this;

      this.updateTimeout = setTimeout(function() { 
        _this._get_updates();
      }, this.interval);
    },

    get_update: function() {
      var previous = this.lastUpdate;
      this.lastUpdate = this.iso_8601_datetime(new Date());

      return $.ajax({
        data: $.extend({
          from: previous,
          to: this.lastUpdate
        }, this.updateData)
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

    /**
     * API methods
     */
    process_update: function(data, textStatus, jqXHR) {},
    process_update_fail: function(jqXHR, textStatus, errorThrown) {},
    refresh: function() {}
  });

}(jQuery));