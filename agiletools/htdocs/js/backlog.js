$(document).ready(function() {
  initials = [""];
  if(window.milestones) {
    topLevel = window.milestones.results;
    if(topLevel.length > 0) {
      firstMilestone = topLevel[0];
      initials.push(firstMilestone.text);
      if(firstMilestone.children.length > 0) {
        initials.push(firstMilestone.children[0].text);
      }
    }
    window.formToken = $("#form input").val();
    backlog = new Backlog("#content", initials);
  }
});

var Backlog = LiveUpdater.extend({

  init: function(appendTo, initialMilestones) {
    this.appendTo = appendTo;
    this.draw();
    this.length = 0;
    this.milestones = {};
    this.tickets = {};

    for(var i = 0; i < initialMilestones.length; i ++) {
      this.add_milestone(initialMilestones[i]);
    }

    this.events();
  },

  draw: function() {
    this.$controls  = $("<div id='backlog-controls'></div>").appendTo(this.appendTo);
    this.$select      = $("<input type='hidden' />").appendTo(this.$controls);
    this.$container = $("<div id='backlog' class='row-fluid'></div>").appendTo(this.appendTo);

    var _this = this;
    this.$select.select2({
      allowClear: false,
      width: "off",
      containerCssClass: $(this).attr("id"),
      dropdownCssClass: "width-auto",
      data: window.milestones,
      placeholder: "Milestones",
      formatResult: function(object, container) {
        container.toggleClass("select2-disabled", object.text in _this.milestones);
        return object.text;
      },
    });

    this.$container.sortable({
      handle: ".top",
      items: "> *:not(#product-backlog)"
    });
  },

  add_milestone: function(name) {
    this.length ++;
    this.milestones[name] = new BacklogMilestone(this, name);
    if(this.length == 4) {
      this.$select.select2("readonly", true);
    }
    this.add_remove_milestone();
  },

  _remove_milestone_references: function(milestone) {
    this.length --;
    delete this.milestones[milestone.name];
    this.$select.select2("readonly", false);
    this.add_remove_milestone();
  },

  _remove_ticket_references: function(ticket) {
    delete this.tickets[ticket.tData.id];
  },

  add_remove_milestone: function() {
    this.set_spans();
    this.refresh_sortables();
  },

  remove_ticket: function(ticket) {
    ticket.milestone.remove_ticket(ticket);
    delete this.tickets[ticket.tData.id];
  },

  move_ticket: function(ticket, from, to) {
    from._remove_ticket_references(ticket);
    to._add_ticket_references(ticket);
    from.set_stats();
    to.set_stats();
  },

  refresh_sortables: function() {
    this.$container.sortable("refreshPositions");
  },

  set_spans: function() {
    var spanLength = 12 / this.length;
    for(var milestone in this.milestones) {
      this.milestones[milestone].$container.attr("class", "span" + spanLength);
    }
  },

  events: function() {
    var _this = this;
    this.$select.on("change", function() {
      // Add the milestone if not already present
      var val = $(this).val();
      if(!_this.milestones.hasOwnProperty(val)) {
        _this.add_milestone(val);
      }
      $(this).select2("val", "");
    });
  }

});

var BacklogMilestone = Class.extend({

  init: function(backlog, name) {
    this.backlog = backlog;
    this.name = name;
    this.draw();
    this.set_label();

    this.total_hours = 0;
    this.length = 0;
    this.tickets = {};
    this.get_tickets();

    this.events();
  },

  draw: function() {
    this.$container = $("<div></div>").appendTo(this.backlog.$container);
    this.$top       = $("<div class='top'></div>").appendTo(this.$container);
    this.$stats     =   $("<div class='hours'><i class='icon-spin icon-spinner'></i></div>").appendTo(this.$top);
    this.$title     =   $("<div class='title'></div>").appendTo(this.$top);
    this.$filter    = $("<input class='filter' type='text' placeholder='Filter Tickets...' />").appendTo(this.$container);
    
    this.$tktWrap   = $("<div class='tickets-wrap'></div>").appendTo(this.$container)
    this.$table       = $("<table class='tickets'></table>").appendTo(this.$tktWrap);
    this.$tBody         =   $("<tbody><tr><td class='wait'><i class='icon-spin icon-spinner'></i></td></tr></tbody>").appendTo(this.$table);
    this.$tBody.data("_self", this);

    if(this.name == "") {
      this.$container.attr("id", "product-backlog");
    }
    else {
      this.$closeBtn = $("<div class='right btn btn-mini'><i class='icon-remove'></i></div>")
                          .prependTo(this.$top).tooltip({ title: "Close", container: "body" });
    }
  },

  set_label: function() {
    this.$title.text(this.name == "" ? "Product Backlog" : this.name);
  },

  get_tickets: function(tickets) {
    var _this = this;
    this.xhr = $.ajax({
      data: { "milestone": this.name },
      success: function(data, textStatus, jqXHR) {
        if(data.hasOwnProperty("tickets")) {
          for(var ticket in data.tickets) {
            _this.add_ticket(data.tickets[ticket]);
          }
        }
        if(_this.length == 0) _this.set_empty_message();
        _this.set_stats();
        _this.set_sortable();
      }
    });
  },

  add_ticket: function(tData) {
    if(this.length == 0) this.clear_empty_message();
    var ticket = new MilestoneTicket(this.backlog, this, tData);
    this._add_ticket_references(ticket);
  },

  _add_ticket_references: function(ticket) {
    this.total_hours += ticket.tData.hours;
    this.tickets[ticket.tData.id] = ticket;
    this.length ++;
  },

  _remove_ticket_references: function(ticket) {
    this.total_hours -= ticket.tData.hours;
    delete this.tickets[ticket.tData.id];
    this.length --;
  },

  set_stats: function() {
    this.$stats.html(this.length + " tickets &mdash; " + this.total_hours + " hours");
  },

  set_empty_message: function() {
    this.$tBody.html("<tr class='none'><td>No tickets</td></tr>");
  }, 

  clear_empty_message: function() {
    this.$tBody.html("");
  },

  set_sortable: function() {
    this.$tBody.sortable({
      connectWith: ".tickets tbody",
      start: function(event, ui) {
        ui.item.data("index", $("tr", ui.item.parent()).index(ui.item));
      },
      stop: function(event, ui) {
        var ticket = ui.item.data("_self"),
            newParent = ui.item.parent().data("_self");
            newIndex = $("tr", ui.item.parent()).index(ui.item);

        $(".none", ui.item.parent()).remove();

        // If a new milestone, or a new index, save changes
        if(ticket.milestone.name != newParent.name ||
           ui.item.data("index") != newIndex) {
          ticket.save_changes();
        }
      }
    });
  },

  _filter_map: {
    "priority:": ["priority", "starts_with"],
    "type:": ["type", "starts_with"],
    "summary:": ["summary", "is_in"],
    "reporter:": ["reporter", "is_in"],
    "component:": ["component", "is_in"],
    "type": ["type", "is_in"]
  },

  _get_filter: function(name) {
    function search_friendly(input) {
      return input.toString().toLowerCase();
    }

    filters = {
      is_in: function(input, comparedWith) {
        return search_friendly(comparedWith).indexOf(input) != -1;
      },
      starts_with: function(input, comparedWith) {
        return search_friendly(comparedWith).indexOf(input) == 0;
      },
      equals: function(input, comparedWith) {
        return search_friendly(comparedWith) == input;
      }
    };

    return filters[name] || filters.is_in;
  },

  // Add a slight delay so we don't query any more than we need to
  filter_tickets: function() {
    var _this = this;
    clearTimeout(this.filterTimeout);
    this.filterTimeout = setTimeout(function() {
      _this._do_filter.apply(_this);
    }, 300);
  },

  _do_filter: function() {
    var query = $.trim(this.$filter.val().toLowerCase());

    // Empty query, don't do anything
    if(query == "") {
      this.$container.addClass("no-filter");
    }

    // If we enter a hash, then instead of filtering we scroll to the ticket
    else if(query.indexOf("#") == 0) {
      var ticketId = query.substring(1);
      if(ticketId in this.tickets) {
        // We need relative positioning to calculate, but it prevents us
        // from moving tickets between milestones, so turn on/calculate/off
        this.$table.css("position", "relative");
        this.$tktWrap.scrollTop(this.tickets[ticketId].$container.position().top);
        this.$table.removeAttr("style");
      }
    }

    else {
      this.$tktWrap.scrollTop(0);

      // Support multiple queries separated by a comma
      var queries = query.split(","),
          queriesLength = queries.length,
          queries_sorted = [];
          sortedLength = 0;

      // Parse our query
      for(var i = 0; i < queriesLength ; i ++) {
        var query = $.trim(queries[i]),
            usingFilter = false;

        // Check for keywords such as # or priority:
        // if we find one being used, but the value is blank, we disregard
        for(var filter in this._filter_map) {
          if(query.indexOf(filter) == 0) {
            query = $.trim(query.substring(filter.length));
            if(query) {
              queries_sorted.push([query, this._filter_map[filter]]);
              sortedLength ++;
            }
            usingFilter = true;
            break;
          }
        }

        // No explicit filter
        if(!usingFilter) {
          queries_sorted.push([query]);
          sortedLength ++;
        }
      }

      // We've parsed our query and actually have something to check against
      if(sortedLength) {

        this.$container.removeClass("no-filter");

        for(var ticket_id in this.tickets) {
          var ticket = this.tickets[ticket_id];
          ticket.toggle_visibility(this._ticket_satisfies_query(ticket, queries_sorted))
        }
      }

      // Our parsed query string contained nothing worth filtering
      else {
        this.$container.addClass("no-filter");
      }
    }
  },

  _ticket_satisfies_query: function(ticket, queries) {
    var defaultFields = ["id", "summary"],
        defaultLength = defaultFields.length;

    for(var i = 0; i < queries.length; i ++) {
      var input = queries[i][0],
          filter = queries[i][1],
          passesTests = false;

      // Using a filter
      if(filter) {
        var field = ticket.tData[filter[0]],
            f = this._get_filter(filter[1]);

        if(f(input, field)) {
          passesTests = true;
        }
      }
      else {
        for(var j = 0; j < defaultLength; j ++) {
          if(this._get_filter("is_in")(input, ticket.tData[defaultFields[j]])) {
            passesTests = true;
            break;
          }
        }
      }
      if(!passesTests) break;
    }

    return passesTests;
  },

  remove: function() {
    this.xhr.abort(); // Stop loading new tickets
    for(var ticket in this.tickets) {
      this.tickets[ticket].remove();
    }
    this.backlog._remove_milestone_references(this);
    if(this.$closeBtn) this.$closeBtn.tooltip("destroy");
    this.$container.remove();
    clearTimeout(this.filterTimeout);
  },

  events: function() {
    this.$filter.on("keyup", $.proxy(this.filter_tickets, this));
    if(this.$closeBtn) {
      this.$closeBtn.on("click", $.proxy(this.remove, this));
    }
  }
});

var MilestoneTicket = Class.extend({

  init: function(backlog, milestone, tData) {
    this.backlog = backlog;
    this.milestone = milestone;
    this.tData = tData;

    this.draw();
    this.events();

    this.milestone.tickets[tData.id] = this;
    this.backlog.tickets[tData.id] = this;

  },

  draw: function() {
    this.$container = $("<tr>" +
      "<td class='priority' data-priority='" + this.tData.priority_value + "'></td>" +
      "<td class='id'>#" + this.tData.id + "</td>" +
      "<td class='summary'>" +
        "<a href='" + window.tracBaseUrl + "ticket/" + this.tData.id + "'>"
          + this.tData.summary + 
        "</a>" +
      "</td>" +
      "<td class='hours'>" + this.tData.hours + " hours</td>" +
    "</tr>");

    this.$container.appendTo(this.milestone.$tBody).data("_self", this);
  },

  save_changes: function() {
    var _this = this,
        $next = this.$container.next(),
        $prev = this.$container.prev(),
        newParent = this.$container.parent().data("_self"),
        data = { 
          '__FORM_TOKEN': window.formToken,
          'ticket': this.tData.id,
          'ts': this.tData['changetime']
        };

    if($next.length) {
      data['relative_direction'] = "before";
      data['relative'] = $next.data("_self").tData.id;
    }
    else if($prev.length) {
      data['relative_direction'] = "after";
      data['relative'] = $prev.data("_self").tData.id;
    }

    if(newParent.name != this.milestone.name) {
      data['milestone'] = newParent.name;
    }

    $.ajax({
      type: "POST",
      data: data,
      success: function(data, textStatus, jqXHR) {
        if(data.hasOwnProperty("success")) {
          _this.backlog.move_ticket(_this, _this.milestone, newParent);
          _this.milestone = newParent;
        }
      }
    })
  },

  toggle_visibility: function(toggle) {
    this.$container.toggleClass("filter-hidden", !toggle);
  },

  events: function() {
    this.$container.on("mousedown", function() {
      $("td", this).each(function() {
        $(this).width($(this).width());
      });
    });
    this.$container.on("mouseup", function() {
      $("td", this).each(function() {
        $(this).removeAttr("style");
      });
    });
  },

  remove: function() {
    this.backlog._remove_ticket_references(this)
    this.milestone._remove_ticket_references(this);
    this.$container.remove();
  }

});