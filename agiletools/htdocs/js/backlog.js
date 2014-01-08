$(document).ready(function() {
  if(window.milestones) {
    window.formToken = $("#form input").val();
    var backlog = new Backlog("#content", milestones_from_query(), window.backlogAdmin);
  }
});

var Backlog = Class.extend({

  init: function(appendTo, initialMilestones, editable) {
    this.appendTo = appendTo;
    this.draw();
    this.length = 0;
    this.milestones = {};
    this.tickets = {};
    this.editable = editable || false;
    this.firedPush = false;
    this.milestoneOrder = [];

    for(var i = 0; i < initialMilestones.length; i ++) {
      this.add_milestone(initialMilestones[i], false);
    }

    // Replace the URL state to add data to this history point
    this.update_url(true);

    this.events();
  },

  draw: function() {
    this.$controls  = $("<div id='backlog-controls'></div>").appendTo(this.appendTo);
    this.$select      = $("<input type='hidden' />").appendTo(this.$controls);
    this.$container = $("<div id='backlog' class='row-fluid'></div>").appendTo(this.appendTo);
    this.$failDialog = $("<div id='fail-dialog'>" +
                          "Failed to move ticket(s) for the following reasons:" +
                          "<ul></ul>" +
                        "</div>").appendTo(this.appendTo);

    this.$failDialog.dialog({
      modal: true,
      autoOpen: false,
      title: "Failed to save ticket(s)",
      close: function() {
        var ticket = $(this).data("_obj");
        if(ticket) ticket.revert_error.apply(ticket);
        $(this).removeData("_obj");
      },
      buttons: {
        Close: function() { $(this).dialog("close"); }
      }
    });

    var _this = this;
    this.$select.select2({
      allowClear: false,
      width: "off",
      containerCssClass: $(this).attr("id"),
      dropdownCssClass: "width-auto",
      data: window.milestones,
      placeholder: "View milestones",
      formatResult: function(object, container) {
        if(object.text in _this.milestones) {
          return "<i class='icon-check'></i> " + object.text;
        }
        else {
          container.toggleClass("select2-disabled", _this.length == 4);
          return "<i class='icon-check-empty'></i> " + object.text;
        }
      },
    });

    this.$container.sortable({
      handle: ".top .title",
      items: "> *:not(#product-backlog)",
      stop: function(e, ui) {

        // Make a note of the new order by traversing the DOM
        _this.milestoneOrder = [];
        $("> div", _this.$container).each(function(i, elem) {
          _this.milestoneOrder.push($(elem).data("_self").name);
        });

        ui.item.removeAttr("style");
        _this.set_multi_picks();
        _this.update_url(false);
      }
    });
  },

  toggle_milestone: function(name) {
    if(this.milestones[name]) {
      this.milestones[name].remove(true);
    }
    else {
      this.add_milestone(name, true);
    }
  },

  add_milestone: function(name, updateUrl) {
    // Show a maximum of 4 milestones
    if(this.length < 4) {

      // Only add a milestone block if a valid name is supplied
      if(name == "" || $.inArray(name, window.milestonesFlat) != -1) {
        this.length ++;
        this.milestones[name] = new BacklogMilestone(this, name);
        this.milestoneOrder.push(name);
        this.add_remove_milestone(updateUrl);
      }
    }
  },

  _remove_milestone_references: function(milestone, updateUrl) {
    var position = $.inArray(milestone.name, this.milestoneOrder);
    if(position != -1) {
      this.milestoneOrder.splice(position, 1);
    }
    this.length --;
    delete this.milestones[milestone.name];
    this.add_remove_milestone(updateUrl);
  },

  set_multi_picks: function() {
    // Readonly version
    if(!this.editable) return;
    for(var i = 0; i < this.length; i ++) {
      var milestone = this.milestones[this.milestoneOrder[i]];
      if(i + 1 < this.length) {
        milestone.multi_pick_enable();
      }
      else {
        milestone.multi_pick_disable();
      }
    }
  },

  _remove_ticket_references: function(ticket) {
    delete this.tickets[ticket.tData.id];
  },

  // Update the URL with the current list of milestones
  update_url: function(replace) {
    var _this = this
        milestones = [];

    for(var i = 0; i < this.length; i ++) {
      var milestone = this.milestones[this.milestoneOrder[i]];
      milestones.push({
        name: "m", value: milestone.name
      });
    }

    // See https://github.com/browserstate/history.js/issues/312
    this.firedPush = true;

    // On page load we update (replace) the history state, else we make a new one
    if(replace) {
      History.replaceState(this.milestoneOrder, document.title, "?" + $.param(milestones));
    }
    else {
      History.pushState(this.milestoneOrder, document.title, "?" + $.param(milestones));
    }
  },

  // Popstate fired: user has gone back/forward in their history
  // Check for milestones in this state and refresh
  popstate: function() {
    if(!this.firedPush) {
      var previousMilestones = History.getState().data,
          previousLength = previousMilestones.length,
          unused = {};

      // Make a note of all current milestones and detach their DOM elements
      // Note detach* not remove, we don't want to remove events or data
      for(var current in this.milestones) {
        unused[current] = true;
        this.milestones[current].$container.detach();
      }

      // Loop through all milestones we now need to show
      // Add them if they don't currently exist, and put them into the DOM
      for(var i = 0; i < previousLength; i ++) {
        var name = previousMilestones[i];

        if(!(name in this.milestones)) {
          this.add_milestone(name, false);
        }

        delete unused[name];
        this.$container.append(this.milestones[name].$container);
      }

      // Our unused object now contains references to no longer needed milestones
      for(var oldMilestone in unused) {
        this.milestones[oldMilestone].remove(false);
      }

      // Swap our current data with the popstate data
      this.milestoneOrder = previousMilestones;
      this.add_remove_milestone(false);
    }
    this.firedPush = false;
  },

  add_remove_milestone: function(updateUrl) {
    this.set_spans();
    this.refresh_sortables();
    this.set_multi_picks();
    if(updateUrl) this.update_url(false);
  },

  remove_ticket: function(ticket) {
    ticket.milestone.remove_ticket(ticket);
    delete this.tickets[ticket.tData.id];
  },

  move_ticket: function(ticket, from, to) {
    from._remove_ticket_references(ticket);
    to._add_ticket_references(ticket);
    from.set_stats(false);
    to.set_stats(false);
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
      _this.toggle_milestone($(this).val());
      $(this).select2("val", "").select2("open");
    });

    if(window.history && window.history.pushState) {
      $(window).on("popstate", $.proxy(_this.popstate, _this));
    }
    else {
      $(window).on("hashchange", $.proxy(_this.popstate, _this));
    }
  }
});

var BacklogMilestone = LiveUpdater.extend({

  init: function(backlog, name) {
    this.backlog = backlog;
    this.name = name;
    this.draw();
    this.set_label();

    this.total_hours = 0;
    this.length = 0;
    this.tickets = {};
    this.get_tickets();

    // TODO make normal updates work normally
    // Complete refresh every 10 minutes
    this.init_updates({
      dt: { "milestone": this.name },
      interval: 600,
      fullRefreshAfter: 1
    });

    this.events();
  },

  draw: function() {

    function draw_button(icon, tooltip_title) {
      return $("<div class='btn' title='"+ tooltip_title + "'><i class='icon-" + icon + "'></i></div>").tooltip({
        container: "body"
      });
    }

    this.$container = $("<div></div>").appendTo(this.backlog.$container).data("_self", this);
    this.$top       = $("<div class='top'></div>").appendTo(this.$container);

    this.$stats     =   $("<div class='hours'><i class='icon-spin icon-spinner'></i></div>").appendTo(this.$top);

    if(this.backlog.editable) {
      this.$selectionControls = $("<div class='ticket-selection'>").appendTo(this.$top);

      this.$mpErrorBtn          = draw_button("exclamation-sign color-warning", "View errors").addClass("hidden").appendTo(this.$selectionControls);
      this.$mpErrorBtn.on("click", $.proxy(this.multi_pick_show_errors_msg, this));

      this.$moveTicketsBtn      = draw_button("chevron-right", "Move selected tickets to neighbouring milestone").addClass("hidden").appendTo(this.$selectionControls);
      this.$moveTicketsBtn.on("click", $.proxy(this.move_selection, this));

      this.$selectionToggleBtn  = draw_button("check", "Select all").appendTo(this.$selectionControls);
      this.selection_unselected();
    }

    this.$title     =   $("<div class='title'></div>").appendTo(this.$top);
    this.$filter    = $("<input class='filter' type='text' />").appendTo(this.$container).valueLabel("Filter Tickets...");

    if(this.backlog.editable) {
      this.$multiPick = $("<div class='multi-pick'></div>").appendTo(this.$container);
      this.$mpPlaceholder = $("<div class='multi-pick-placeholder'></div>");
    }

    this.$tktWrap   = $("<div class='tickets-wrap'></div>").appendTo(this.$container)
    this.$table       = $("<table class='tickets'></table>").appendTo(this.$tktWrap);
    this.$tBody         =   $("<tbody><tr><td class='wait'><i class='icon-spin icon-spinner'></i></td></tr></tbody>").appendTo(this.$table);
    this.$tBody.data("_self", this);


    if(this.name == "") {
      this.$container.attr("id", "product-backlog");
    }
    else {
      this.$closeBtn = draw_button("remove", "Close milestone").addClass("right").prependTo(this.$top);
    }
  },

  set_label: function() {
    this.$title.text(this.name == "" ? "Product Backlog" : this.name);
  },

  get_tickets: function() {
    var _this = this;
    this.$tBody.html("");
    this.xhr = $.ajax({
      data: { "milestone": this.name },
      success: function(data, textStatus, jqXHR) {
        if(data.hasOwnProperty("tickets")) {
          for(var ticket in data.tickets) {
            _this.add_ticket(data.tickets[ticket]);
          }
        }
        if(_this.length == 0) _this.set_empty_message();
        _this.set_sortable();
        _this._do_filter();
      }
    });
  },

  refresh: function(removeFilter) {
    if(removeFilter) this.$filter.val("");
    if(this.backlog.editable) this.multi_pick_stop();
    this.remove_all_tickets();
    this.get_tickets();
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
    var selection = this.mpSelection || this.filterSelection || false;
    this.$stats.removeClass("selection filtered");
    if(selection) {
      this.$stats.addClass(this.mpSelection ? "selection" : "filtered");
      var hours = 0,
          tickets = 0;
      for(var selectedId in selection) {
        tickets ++;
        hours += selection[selectedId].tData.hours;
      }
    }
    else {
      var hours = this.total_hours,
          tickets = this.length;
    }
    this.$stats.html(
      "<i class='icon-ticket'></i> " + tickets +
      "<i class='margin-left-small icon-time'></i> " + pretty_time(hours)
    );
  },

  set_empty_message: function() {
    this.$tBody.html("<tr class='none ui-state-disabled'><td>No tickets</td></tr>");
  }, 

  clear_empty_message: function() {
    this.$tBody.html("");
  },

  set_sortable: function() {
    if(this.backlog.editable) {
      this.$tBody.sortable({
        items: "> tr:not(.ui-state-disabled)",
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
    }
  },

  refresh_sortables: function() {
    this.$tBody.sortable("refreshPositions");
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
    if(this.backlog.editable) this.multi_pick_stop();
    var query = $.trim(this.$filter.val().toLowerCase());

    delete this.filterSelection;

    // Empty query, don't do anything
    // TODO - remove the additional check when we improve valueLabel
    if(query == "" || query == "filter tickets...") {
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
        this.filterSelection = {};
        for(var ticket_id in this.tickets) {
          var ticket = this.tickets[ticket_id],
              visible = this._ticket_satisfies_query(ticket, queries_sorted);

          ticket.toggle_visibility(visible);
          if(visible) this.filterSelection[ticket_id] = ticket;
        }
      }

      // Our parsed query string contained nothing worth filtering
      else {
        this.$container.addClass("no-filter");
      }
    }

    this.set_stats();
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

  remove: function(updateUrl) {
    this.remove_all_tickets();
    this.backlog._remove_milestone_references(this, updateUrl);
    if(this.$closeBtn) this.$closeBtn.tooltip("destroy");
    this.$container.remove();
    clearTimeout(this.filterTimeout);
  },

  remove_all_tickets: function() {
    this.xhr.abort(); // Stop loading new tickets
    for(var ticket in this.tickets) {
      this.tickets[ticket].remove();
    }
  },

  multi_pick_enable: function() {
    this.$multiPick.removeClass("hidden");
    this.$selectionControls.removeClass("hidden");
  },

  multi_pick_disable: function() {
    this.$multiPick.addClass("hidden");
    this.$selectionControls.addClass("hidden");
  },

  multi_pick_start: function() {
    var _this = this,
        offset = this.$tktWrap.offset().top;

    this.mp_manual = true;
    this.$tBody.sortable("disable");

    if(!this.mpMinHeight) this.mpMinHeight = this.$multiPick.height();

    this.$mpPlaceholder.insertBefore(this.$multiPick);
    this.$multiPick.addClass("dragging");

    var maxHeight = this.$tktWrap.height() + this.mpMinHeight;

    $(document).on("mousemove", function(e) {
      $("body").attr('unselectable', 'on')
               .css('user-select', 'none')
               .on('selectstart', false);
      var height = Math.min(Math.max(_this.mpMinHeight, e.pageY - offset + (1.5*_this.mpMinHeight)), maxHeight);
      _this.$multiPick.css("height", height);
    });
    $(document).one("mouseup", function() {_this.multi_pick_process() });
  },

  /* Picking all resembles the multi-pick functionality (move our toggle to the bottom) */
  multi_pick_all: function() {
    var _this = this,
        mpHeight = this.$multiPick.height(),
        totalHeight = this.$tktWrap.height() + mpHeight;

    this.mpMinHeight = mpHeight;

    this.$tktWrap.scrollTop(this.$table.height());
    this.$mpPlaceholder.insertBefore(this.$multiPick);
    this.$multiPick.addClass("dragging").css("height", totalHeight);
    this.multi_pick_process(true);
  },

  multi_pick_process: function(all) {
    $(document).off("mousemove");
    $("body").removeAttr('unselectable')
             .removeAttr('style')
             .off('selectstart');

    if(!all) {
      // Calculate visible tickets below picker level
      var _this = this,
          position = this.$tktWrap.position().top,
          adjustedHeight = Math.floor(this.$multiPick.height() - _this.mpMinHeight);

      // Picker very close to it's original place: stop
      if(adjustedHeight < 5) {
        this.multi_pick_stop();
        return;
      }
      else {
        this.mpSelection = {};

        $("tr:visible:not(.ui-state-disabled)", this.$tBody).each(function() {
          var ticket = $(this).data("_self"),
              ticketBottom = Math.floor($(this).position().top - position + $(this).height());

          if(ticketBottom > adjustedHeight) return false;
          _this.mpSelection[ticket.tData.id] = ticket;
        });
      }
    }

    else {
      this.mpSelection = this.filterSelection || this.tickets;
    }

    this.selection_selected();
    this.set_stats();

    this.$moveTicketsBtn.removeClass("hidden");
  },

  multi_pick_stop: function(e) {
    // When we select all we scroll to the bottom of the page
    // But we don't want that to stop the multi pick
    // This is the best fix I could think of for stackoverflow.com/questions/19766675/
    var event_type = e ? e.type : undefined;
    if(!(event_type == "scroll" && !this.mp_manual)) {
      $(window).off("mousemove");
      this.$moveTicketsBtn.addClass("hidden");
      this.$mpPlaceholder.remove();
      this.$multiPick.removeAttr("style").removeClass("dragging");
      this.$tBody.sortable("enable");

      delete this.mpSelection;
      this.set_stats();
      this.selection_unselected();
    }
  },

  multi_pick_show_errors: function(errors) {
    this._errors = errors;
    this.$mpErrorBtn.removeClass("hidden");
  },

  multi_pick_show_errors_msg: function() {
    var errors = this._errors || [],
        $list = $("ul", this.backlog.$failDialog).html("");

    this.backlog.$failDialog.data("_obj", this).dialog("open");
    for(var i = 0; i < this._errors.length; i ++) {
      var ticketId = this._errors[i][0],
          ticketErrors = this._errors[i][1],
          $tErrors = $("<li>Errors for ticket #"+ ticketId + "</li>").appendTo($list);
          $tList = $("<ul></ul>").appendTo($tErrors);

      for(var j = 0; j < ticketErrors.length; j ++) {
        $tList.append("<li>" + ticketErrors[j] + "</li>");
      }
    }
  },

  revert_error: function() {
    delete this._errors;
    this.$mpErrorBtn.addClass("hidden");
  },

  selection_selected: function() {
    this.$selectionToggleBtn.html("<i class='icon-check'></i>")
                            .off("click")
                            .on("click", $.proxy(this.multi_pick_stop, this))
                            .attr("data-original-title", "Remove selection")
                            .tooltip("fixTitle");
  },

  selection_unselected: function() {
    this.mp_manual = false;
    this.$selectionToggleBtn.html("<i class='icon-check-empty'></i>")
                            .off("click")
                            .on("click", $.proxy(this.multi_pick_all, this))
                            .attr("data-original-title", "Select all")
                            .tooltip("fixTitle");
  },

  move_selection: function() {
    var $moveIcon = $("i", this.$moveTicketsBtn);
    if(!$moveIcon.hasClass("icon-spinner")) {
      $moveIcon.attr("class", "icon-spin icon-spinner");
      var _this = this,
          ticketChangetimes = [],
          ticketIds = [],
          neighbour = this.$container.next().data("_self");

      if(neighbour) {
        for(var selectedId in this.mpSelection) {
          var ticket = this.mpSelection[selectedId];
          ticketChangetimes.push(ticket.tData.changetime);
          ticketIds.push(ticket.tData.id);
        }
        $.ajax({
          type: "POST",
          data: {
            '__FORM_TOKEN': window.formToken,
            'tickets': ticketIds.join(","),
            'changetimes': ticketChangetimes.join(","),
            'milestone': neighbour.name
          },
          success: function(data, textStatus, jqXHR) {
            if(data.hasOwnProperty("errors")) {
              _this.multi_pick_show_errors(data.errors);
            }

            neighbour.refresh(true);
            _this.refresh(true);

            _this.mp_running = false;
            $moveIcon.attr("class", "icon-chevron-right hidden");
          }
        });
      }
    }
  },

  sortable_before: function() {
    this.backlog.$_to_cancel = this.$container;
    var position = this.$container.position();
    this.$container.css({
      position: "absolute",
      top: position.top,
      left: position.left
    });
  },

  sortable_cancel: function() {
    if(this.backlog.$_to_cancel) {
      this.backlog.$_to_cancel.removeAttr("style");
    }
  },

  events: function() {
    this.$filter.on("keyup", $.proxy(this.filter_tickets, this));
    if(this.$closeBtn) this.$closeBtn.on("click", $.proxy(this.remove, this));

    if(this.backlog.editable) {
      this.$multiPick.on("mousedown", $.proxy(this.multi_pick_start, this));
      this.$tktWrap.on("scroll", $.proxy(this.multi_pick_stop, this));
    }

    if(this.name != "") {
      this.$title.on("mousedown", $.proxy(this.sortable_before, this));
      this.$title.on("mouseup", $.proxy(this.sortable_cancel, this));
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
    "</tr>");

    this.$hoursFeedback = $("<td class='hours'></td>").appendTo(this.$container);
    this.$hours          = $("<span>" + pretty_time(this.tData.hours) + "</span>").appendTo(this.$hoursFeedback);
    this.$feedback        = $("<i class='hidden'></i>").appendTo(this.$hoursFeedback);

    this.$container.appendTo(this.milestone.$tBody).data("_self", this);
  },

  show_wait: function() {
    this.$hours.addClass("hidden");
    this.$feedback.attr("class", "icon-spin icon-spinner");
  },

  hide_wait: function() {
    this.$hours.removeClass("hidden");
    this.$feedback.attr("class", "hidden");
  },

  show_error: function(errors, tmpParent) {
    this._errors = errors || [];
    // Stop user from moving ticket further
    this.$container.addClass("ui-state-disabled");
    tmpParent.refresh_sortables();
    this.$hours.addClass("hidden");
    this.$feedback.attr("class", "icon-exclamation-sign color-warning");
  },

  show_error_msg: function() {
    if(this.$feedback.hasClass("icon-exclamation-sign")) {
      this.backlog.$failDialog.dialog("open").data("_obj", this);
      var $list = $("ul", this.backlog.$failDialog).html("");
      for(var i = 0; i < this._errors.length; i ++) {
        $list.append("<li>" + this._errors[i] + "</li>");
      }
    }
  },

  // Remove the error message and put the back in last legitimate position
  revert_error: function() {
    var $milestoneTickets = $("tr:not(.none)", this.milestone.$tBody);
    $milestoneTickets.eq(this.$container.data("index")).before(this.$container);
    this.$container.removeClass("ui-state-disabled");
    this.milestone.refresh_sortables();
    this.hide_wait();
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

    this.show_wait();

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
        if(data.hasOwnProperty("tickets")) {
          _this.backlog.move_ticket(_this, _this.milestone, newParent);

          // Set empty message if the last ticket moved out of group
          if(_this.milestone.length == 0) {
            _this.milestone.set_empty_message();
            _this.backlog.refresh_sortables();
          }

          _this.milestone = newParent;
          // Update ticket data with new timestamp
          if(data.tickets.length == 1) _this.tData = data.tickets[0];
        }
        if(!data.hasOwnProperty("errors")) {
          _this.hide_wait();
        }
        else {
          _this.show_error(data.errors, newParent);
        }
      }
    })
  },

  toggle_visibility: function(toggle) {
    this.$container.toggleClass("filter-hidden", !toggle);
  },

  events: function() {
    this.$feedback.on("click", $.proxy(this.show_error_msg, this));
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

// Helper Methods
function pretty_time(float_time) {
  var result,
      hours = Math.floor(float_time),
      minutes = Math.floor((float_time - hours) * 60);

  if(hours) {
    result = hours + "h";
    if(minutes) {
      var pad = "0" + minutes.toString();
      result += pad.substring(pad.length - 2) + "m";
    }
  }
  else {
    result = "0h";
  }
  return result;
}

// Retrieve the default milestones
// Try to find ones set in the URL, fallback to more recent if more
function milestones_from_query() {

  var query = $.QueryString,
      initials = [];

  if("m" in query) {
    initials = (query["m"] instanceof Array) ? query["m"] : [query["m"]];
  }

  else {
    var topLevel = window.milestones.results;
    initials.push("");
    if(topLevel.length > 0) {
      firstMilestone = topLevel[0];
      initials.push(firstMilestone.text);
      if(firstMilestone.children.length > 0) {
        initials.push(firstMilestone.children[0].text);
      }
    }
    return initials;
  }

  return initials;
}