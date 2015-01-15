/* =============================================================================
 * backlog.js
 * =============================================================================
 * @author Ian Clark
 * @copyright CGI 2004
 * @file A product backlog for Trac, enabling users to drap and drop tickets
 * to change both their position and milestone. Using history.js to polyfill
 * HTML5 pushState functionality, the backlog can be manipulated to include up
 * to 4 milestones, in any order - both of which persist a page reload. By using
 * the multipicker at the top of a milestone block, the user can select the most
 * prioritised tickets in one go, and move them into a new milestone with a
 * single click. The number of tickets and total hours in a milestone are shown
 * at the top of the page, and are updated when the user makes a selection.
 * TODO - make the backlog properly support live updates.
 * =============================================================================
 * @requires jQuery (>= 1.7)
 * @requires jQuery UI Sortable (>= 1.10)
 * @requires Bootstrap tooltip
 * @requires Resig's Simple Inheritence Model (http://goo.gl/lWUkve)
 * @requires history.js (https://github.com/browserstate/history.js/)
 * ========================================================================== */

(function($, Class, History) { "use strict";

  $(document).ready(function() {
    var backlog;

    if(window.milestones) {
      window.formToken = $("#form input").val();
      backlog = new Backlog("#content", milestones_from_query(), window.backlogAdmin);
    }
  });


  // @namespace
  // BACKLOG PUBLIC CLASS DEFINITION
  // ===============================
  var Backlog = Class.extend({

    /**
     * Initialise a new backlog
     * @constructor
     * @alias Backlog
     * @param {string} appendTo - jQuery selector to append backlog to
     * @param {Array} initialMilestones - List of milestones to initially show
     * @param {Boolean} editable - Where the user has permission to edit the backlog
     */
    init: function(appendTo, initialMilestones, editable) {
      var i;

      this.appendTo = appendTo;
      this.draw();
      this.length = 0;
      this.milestoneLimit = 4;
      this.milestones = {};
      this.tickets = {};
      this.editable = editable || false;
      this.firedPush = false;
      this.milestoneOrder = [];

      for(i = 0; i < initialMilestones.length; i ++) {
        this.add_milestone(initialMilestones[i], false);
      }

      // Replace the URL state to add data to this history point
      this.update_url(true);

      this.events();
    },

    /**
     * Draw the backlog, dialogs, and controls
     * @memberof Backlog
     */
    draw: function() {
      var _this = this;

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

        // Obj could either be a BacklogMilestone or a MilestoneTicket
        close: function() {
          var obj = $(this).data("_obj");
          if(obj) obj.revert_error();
          $(this).removeData("_obj");
        },
        buttons: {
          Close: function() { $(this).dialog("close"); }
        }
      });

      this.$select.select2({
        allowClear: false,
        width: "off",
        containerCssClass: $(this).attr("id"),
        dropdownCssClass: "width-auto",
        data: window.milestones,
        placeholder: "View milestones",
        formatResult: function(object, container) {
          if(object.is_backlog) {
            container.addClass("select2-product-backlog");
          }
          if((object.is_backlog ? "" : object.id) in _this.milestones) {
            return $("<span><i class='icon-check'></i> </span>").append(
		document.createTextNode(object.text))
          }
          else {
            container.toggleClass("select2-disabled", _this.length == 4);
            return $("<span><i class='icon-check-empty'></i> </span>").append(
		document.createTextNode(object.text))
          }
        }
      });

      this.$moreOptions = this.generate_more_options_markup();
      this.$moreOptions.dialog({
        modal: true,
        autoOpen: false
      });
      this.$moreOptions.find("select").select2({
        allowClear: false,
        width: "off",
        dropdownCssClass: "full-width",
      });

      this.$milestoneFailDialog = $("<div id='fail-milestone-dialog'>" +
        "<span>Please remove a milestone from the display before " +
        "opening another. We only display " + this.milestoneLimit +
        " milestones on the backlog page at a time.</span>" +
      "</div>");
      this.$milestoneFailDialog.dialog({
        modal: true,
        autoOpen: false,
        title: "Failed to show milestone"
      });

      // See http://stackoverflow.com/a/17502602/1773904
      // for why we add the first-child class
      this.$container.sortable({
        axis: "x",
        handle: ".top",
        items: ">",
        tolerance: "pointer",
        helper: "clone",
        start: function() {
          $(":visible:first", "#backlog").addClass("first-child");
        },
        change: function() {
          $("#backlog").children().removeClass("first-child")
                       .filter(":visible:first").addClass("first-child");
        },
        stop: function(event, ui) {
          $(".first-child", "#backlog").removeClass("first-child");

          // Make a note of the new order by traversing the DOM
          _this.milestoneOrder = [];
          _this.$container.children("div").each(function() {
            _this.milestoneOrder.push($(this).data("_self").name);
          });

          ui.item.removeAttr("style");
          _this.set_multi_picks();
          _this.update_url(false);
        }
      });
    },

    /**
     * Returns HTML for the more options dialog - including a dynamically 
       generated select list of milestone options.
     * @memberof Backlog
     */
    generate_more_options_markup: function() {
      var $select = $("<select/>");

      // Product Backlog isn't included in milestonesFlat array
      $select.append($("<option/>")
            .attr("value", "")
            .text("Product Backlog"));

      $.each(window.milestonesFlat, function(i, v) {
        $select.append($("<option/>").attr("value", v).text(v));
      });

      return $("<form id='more-options'>" +
        "<label for='desired-milestone' class='full-width-label'>Milestone</label>" +
        "<select id='desired-milestone' class='full-width' name='milestone'>" + $select.html() + "</select>" +
        "<label for='desired-position' class='full-width-label'>Position</label>" +
        "<input id='desired-position' class='full-width' type='number' name='position'>" +
      "</form>");
    },

    /**
     * Toggle a milestone's visibility
     * @memberof Backlog
     * @param {string} name - The name of the milestone to show / hide
     */
    toggle_milestone: function(name) {
      if(this.milestones[name]) {
        this.milestones[name].remove(true);
      }
      else {
        this.add_milestone(name, true);
      }
    },

    /**
     * Add a milestone - show at maximum 4
     * @memberof Backlog
     * @param {string} name - The name of the milestone
     * @param {Boolean} updateUrl - Whether to update the page's URL
     */
    add_milestone: function(name, updateUrl) {
      if(this.length < this.milestoneLimit) {

        // Only add a milestone block if a valid name is supplied
        if(name === "" || $.inArray(name, window.milestonesFlat) !== -1) {
          this.length ++;
          this.milestones[name] = new BacklogMilestone(this, name);
          this.milestoneOrder.push(name);
          this.add_remove_milestone(updateUrl);
        }
      }
      else {
        this.$milestoneFailDialog.dialog("open");
      }
    },

    /**
     * Remove all references to a given milestone
     * @memberof Backlog
     * @param {BacklogMilestone} milestone
     * @param {Boolean} updateUrl - Whether to update the page's URL
     * @private
     */
    _remove_milestone_references: function(milestone, updateUrl) {
      var position = $.inArray(milestone.name, this.milestoneOrder);

      if(position != -1) {
        this.milestoneOrder.splice(position, 1);
      }

      this.length --;
      delete this.milestones[milestone.name];
      this.add_remove_milestone(updateUrl);
    },

    /**
     * Activate the multipick for all milestones other than the right-most
     * @memberof Backlog
     */
    set_multi_picks: function() {
      var i, milestone;

      if(!this.editable) return;

      for(i = 0; i < this.length; i ++) {
        milestone = this.milestones[this.milestoneOrder[i]];

        if(i + 1 < this.length) {
          milestone.multi_pick_enable();
        }
        else {
          milestone.multi_pick_disable();
        }
      }
    },

    /**
     * Remove all references to a given ticket
     * @memberof Backlog
     * @param {Object} ticket - A ticket object
     * @private
     */
    _remove_ticket_references: function(ticket) {
      delete this.tickets[ticket.tData.id];
    },

    /**
     * Update the page's URL with the current list of milestones
     * @memberof Backlog
     * @param {Boolean} replace - Whether to use replaceState or pushState
     */
    update_url: function(replace) {
      var milestones = [], milestone, i;

      for(i = 0; i < this.length; i ++) {
        milestone = this.milestones[this.milestoneOrder[i]];
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

    /**
     * Popstate fired: user has gone back/forward in their history
     * Check for milestones in this state and refresh
     * @memberof Backlog
     */
    popstate: function() {
      var previousMilestones, previousLength, unused, current, i, oldMilestone, name;

      if(!this.firedPush) {
        previousMilestones = History.getState().data;
        previousLength = previousMilestones.length;
        unused = {};

        // Make a note of all current milestones and detach their DOM elements
        // Note detach* not remove, we don't want to remove events or data
        for(current in this.milestones) {
          if(this.milestones.hasOwnProperty(current)) {
            unused[current] = true;
            this.milestones[current].$container.detach();
          }
        }

        // Loop through all milestones we now need to show
        // Add them if they don't currently exist, and put them into the DOM
        for(i = 0; i < previousLength; i ++) {
          name = previousMilestones[i];

          if(!(name in this.milestones)) {
            this.add_milestone(name, false);
          }

          delete unused[name];
          this.$container.append(this.milestones[name].$container);
        }

        // Our unused object now contains references to no longer needed milestones
        for(oldMilestone in unused) {
          if(unused.hasOwnProperty(oldMilestone)) {
            this.milestones[oldMilestone].remove(false);
          }
        }

        // Swap our current data with the popstate data
        this.milestoneOrder = previousMilestones;
        this.add_remove_milestone(false);
      }
      this.firedPush = false;
    },

    /**
     * Always events for adding / removing milestones
     * @memberof Backlog
     * @param {Boolean} updateUrl - Whether to update the page's URL or not
     */
    add_remove_milestone: function(updateUrl) {
      this.set_spans();
      this.refresh_sortables();
      this.set_multi_picks();
      if(updateUrl) this.update_url(false);
    },

    /**
     * Remove a ticket. TODO: remove unused method
     * @memberof Backlog
     * @param {MilestoneTicket} ticket
     * @depreciated
     */
    remove_ticket: function(ticket) {
      ticket.milestone.remove_ticket(ticket);
      delete this.tickets[ticket.tData.id];
    },

    /**
     * Visually move a ticket between milestones
     * @memberof Backlog
     * @param {MilestoneTicket} ticket
     * @param {BacklogMilestone} from
     * @param {BacklogMilestone} to
     */
    move_ticket: function(ticket, from, to) {
      from._remove_ticket_references(ticket);
      to._add_ticket_references(ticket);
      from.set_stats(false);
      to.set_stats(false);
    },

    /**
     * Refresh each milestones sortable position
     * @memberof Backlog
     */
    refresh_sortables: function() {
      this.$container.sortable("refreshPositions");
    },

    /**
     * Depending on the number of active milestones, set their container widths
     * @memberof Backlog
     */
    set_spans: function() {
      var spanLength = 12 / this.length, milestone;

      for(milestone in this.milestones) {
        if(this.milestones.hasOwnProperty(milestone)) {
          this.milestones[milestone].$container.attr("class", "span" + spanLength);
        }
      }
    },

    /**
     * Transform the milestone name using the appropriate logic to decide
     * if a milestone should be referred to as 'Product Backlog', or by its 
     * original name.
     * @memberof Backlog
     * @param {string} name - Name of milestone
     */
    transform_milestone: function(name) {
      // currently we use the psuedo milestone empty string for the backlog
      return name === "" ? "Product Backlog" : name;
    },

    /**
     * Initialise all backlog events
     * @memberof Backlog
     */
    events: function() {
      var _this = this;

      this.$select.on("change", function(e) {

        // Use the select2 data to check if we're adding the backlog or not
        var milestone = e.added.is_backlog ? "" : e.added.id;

        // Toggle the milestone
        _this.toggle_milestone(milestone);

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


  // @namespace
  // BACKLOG MILESTONE PRIVATE CLASS DEFINITION
  // ==========================================
  var BacklogMilestone = $.LiveUpdater.extend({

    /**
     * Initialise a new milestone (invoked by the Backlog)
     * @constructor
     * @alias BacklogMilestone
     * @param {Backlog} backlog - Parent backlog
     * @param {string} name - The name of the milestone
     */
    init: function(backlog, name) {
      this.backlog = backlog;
      this.name = name;
      this.milestone_url = window.tracBaseUrl + "milestone/" + encodeURIComponent(this.name);
      this.draw();
      this.set_label();

      this.total_hours = 0;
      this.total_storypoints = 0;
      this.length = 0;
      this.tickets = {};
      this.get_tickets(true);

      // TODO make normal updates work normally
      // Complete refresh every 10 minutes
      this.init_updates({
        data: { milestone: this.name },
        interval: 600,
        fullRefreshAfter: 1
      });

      this.events();
    },

    /**
     * Draw the milestone box
     * @memberof BacklogMilestone
     */
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

      this.$title     =   $("<a class='title tooltipped' title='View milestone details on roadmap' href='" + this.milestone_url + "'></a>").appendTo(this.$top);
      this.$filter    = $("<input class='filter' type='text' />").appendTo(this.$container).valueLabel("Filter Tickets...");

      if(this.backlog.editable) {
        this.$multiPick = $("<div class='multi-pick'></div>").appendTo(this.$container);
        this.$mpPlaceholder = $("<div class='multi-pick-placeholder'></div>");
      }

      this.$tktWrap   = $("<div class='tickets-wrap'></div>").appendTo(this.$container);
      this.$table       = $("<table class='tickets'></table>").appendTo(this.$tktWrap);
      this.$tBody         =   $("<tbody><tr><td class='wait'><i class='icon-spin icon-spinner'></i></td></tr></tbody>").appendTo(this.$table);
      this.$tBody.data("_self", this);


      if(this.name === "") {
        this.$container.attr("id", "product-backlog");
      }

      this.$closeBtn = draw_button("remove", "Remove milestone from display").addClass("right").prependTo(this.$top);
    },

    /**
     * Given it's name, set the label for a milestone. If blank, assume Product Backlog
     * @memberof BacklogMilestone
     */
    set_label: function() {
      this.$title.text(this.backlog.transform_milestone(this.name));
    },

    /**
     * Make an Ajax call to retrieve a milestone's tickets
     * @memberof BacklogMilestone
     * @param {Boolean} [first] - Whether this is the first run
     * @returns {Deferred}
     */
    get_tickets: function(first) {
      this.xhr = $.ajax({ data: { milestone: this.name }, cache: false });

      $.when(this.xhr).then($.proxy(this, "_get_tickets_response", first));
      return this.xhr;
    },

    /**
     * With the response, add the tickets, set the sortables, and re-run the filter
     * @private
     * @memberof BacklogMilestone
     */
    _get_tickets_response: function(first, data) {
      var ticket;

      if(!first) {
        if(this.backlog.editable) this.multi_pick_stop();
        this.remove_all_tickets();
        this.$tBody.html("");
      }

      if(data.hasOwnProperty("tickets")) {
        for(ticket in data.tickets) {
          if(data.tickets.hasOwnProperty(ticket)) {
            this.add_ticket(data.tickets[ticket]);
          }
        }
      }
      if(this.length === 0) this.set_empty_message();
      this.set_sortable();
      this._do_filter();
    },

    /**
     * LiveUpdater's complete refresh method
     * @memberof BacklogMilestone
     * @param {Boolean} removeFilter - Whether to remove
     * @returns {Promise}
     */
    refresh: function(removeFilter) {
      if(removeFilter) this.$filter.val("");
      return this.get_tickets().promise();
    },

    /**
     * Instantiate a new MilestoneTicket based on ticket data
     * @memberof BacklogMilestone
     * @param {Object} tData - Ticket data
     */
    add_ticket: function(tData) {
      var ticket;

      if(this.length === 0) this.clear_empty_message();
      ticket = new MilestoneTicket(this.backlog, this, tData);
      this._add_ticket_references(ticket);
    },

    /**
     * Add a MilestoneTicket to a milestone, incrementing its total hours / count
     * @memberof BacklogMilestone
     * @param {MilestoneTicket} ticket
     */
    _add_ticket_references: function(ticket) {
      this.total_hours += ticket.tData.hours;
      this.total_storypoints += ticket.tData.effort;
      this.tickets[ticket.tData.id] = ticket;
      this.length ++;
    },

    /**
     * Remove a MilestoneTicket from a milestone, decrementing its total hours / count
     * @memberof BacklogMilestone
     * @param {MilestoneTicket} ticket
     */
    _remove_ticket_references: function(ticket) {
      this.total_hours -= ticket.tData.hours;
      this.total_storypoints -= ticket.tData.effort;
      delete this.tickets[ticket.tData.id];
      this.length --;
    },

    /**
     * Set the milestone's stats in the user interface (depends on a selection)
     * @memberof BacklogMilestone
     */
    set_stats: function() {
      var selection = this.mpSelection || this.filterSelection || false,
          hours, tickets, storypoints, selectedId;

      this.$stats.removeClass("selection filtered");

      if(selection) {
        hours = tickets = storypoints = 0;
        this.$stats.addClass(this.mpSelection ? "selection" : "filtered");

        for(selectedId in selection) {
          if(selection.hasOwnProperty(selectedId)) {
            tickets ++;
            hours += selection[selectedId].tData.hours;
            storypoints += selection[selectedId].tData.effort;
          }
        }
      }
      else {
        hours = this.total_hours;
        tickets = this.length;
        storypoints = this.total_storypoints;
      }
      this.$stats.html(
        "<i class='icon-ticket'></i> " + tickets +
        "<i class='margin-left-small icon-reorder'></i> " + storypoints +
        "<i class='margin-left-small icon-time'></i> " + pretty_time(hours)
      );
    },

    /**
     * Set an empty message in the  user interface when no tickets exist
     * @memberof BacklogMilestone
     */
    set_empty_message: function() {
      this.$tBody.html("<tr class='none ui-state-disabled'><td>No tickets</td></tr>");
    },

    /**
     * Remove an empty message from the user interface
     * @memberof BacklogMilestone
     */
    clear_empty_message: function() {
      this.$tBody.html("");
    },

    /**
     * Provided the user can edit the backlog, intialise sorting tickets
     * @memberof BacklogMilestone
     */
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
                newParent = ui.item.parent().data("_self"),
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

    /**
     * Refresh the position and state of the sortables in a milestone
     * @memberof BacklogMilestone
     */
    refresh_sortables: function() {
      this.$tBody.sortable("refreshPositions");
    },

    _filter_map: {
      "priority:": ["priority", "starts_with"],
      "type:": ["type", "starts_with"],
      "summary:": ["summary", "is_in"],
      "reporter:": ["reporter", "is_in"],
      "component:": ["component", "is_in"]
    },

    /**
     * Given a filter name, try to return it's function, else return the default
     * @private
     * @memberof BacklogMilestone
     * @param {string} name - the name of the filter
     * @returns {function} The filter function
     */
    _get_filter: function(name) {
      var filters = {
        is_in: function(input, comparedWith) {
          return search_friendly(comparedWith).indexOf(input) !== -1;
        },
        starts_with: function(input, comparedWith) {
          return search_friendly(comparedWith).indexOf(input) === 0;
        },
        equals: function(input, comparedWith) {
          return search_friendly(comparedWith) == input;
        }
      };

      function search_friendly(input) {
        return input.toString().toLowerCase();
      }

      return filters[name] || filters.is_in;
    },

    /**
     * Filtering the tickets in a milestone given the value of this.$filter
     * @memberof BacklogMilestone
     */
    filter_tickets: function() {
      if(this.filterDeferred) this.filterDeferred.reject();

      this.filterDeferred = $.wait(300);
      this.filterDeferred.then($.proxy(this, "_do_filter"));
    },

    /**
     * Actual filtering process, which is throttled by filter_tickets
     * @private
     * @memberof BacklogMilestone
     */
    _do_filter: function() {
      var queryString = $.trim(this.$filter.val().toLowerCase()),
          queries, ticketId, ticket, visible;

      if(this.backlog.editable) this.multi_pick_stop();
      delete this.filterSelection;

      // Empty query, don't do anything
      // TODO - remove the additional check when we improve valueLabel
      if(queryString === "" || queryString === "filter tickets...") {
        this.$container.addClass("no-filter");
      }

      // If we enter a hash, then instead of filtering we scroll to the ticket
      else if(queryString.indexOf("#") === 0) {
        ticketId = queryString.substring(1);

        // We need relative positioning to calculate, but it prevents us
        // from moving tickets between milestones, so turn on/calculate/off
        if(ticketId in this.tickets) {
          this.$table.css("position", "relative");
          this.$tktWrap.scrollTop(this.tickets[ticketId].$container.position().top);
          this.$table.removeAttr("style");
        }
      }

      else {
        queries = this._process_query(queryString);
        this.$tktWrap.scrollTop(0);

        // We've parsed our query and actually have something to check against
        if(queries.length) {
          this.$container.removeClass("no-filter");
          this.filterSelection = {};

          for(ticketId in this.tickets) {
            if(this.tickets.hasOwnProperty(ticketId)) {
              ticket = this.tickets[ticketId];
              visible = this._ticket_satisfies_queries(ticket, queries);

              ticket.toggle_visibility(visible);
              if(visible) this.filterSelection[ticketId] = ticket;
            }
          }
        }

        // Our parsed query string contained nothing worth filtering
        else {
          this.$container.addClass("no-filter");
        }
      }

      this.set_stats();
    },

    /**
     * Process a raw query string into a list of queries
     * @private
     * @memberof BacklogMilestone
     * @param {string} queryString - The unfiltered query string
     * @returns {Array} - A list of sorted queries
     */
    _process_query: function(queryString) {
      var queries = queryString.split(","),
          queriesLength = queries.length,
          queriesSorted = [], filter, query, i, usingFilter;

      // Parse our query
      for(i = 0; i < queriesLength ; i ++) {
        query = $.trim(queries[i]);
        usingFilter = false;

        // Check for keywords such as # or priority:
        // if we find one being used, but the value is blank, we disregard
        for(filter in this._filter_map) {
          if(this._filter_map.hasOwnProperty(filter) && query.indexOf(filter) === 0) {
            query = $.trim(query.substring(filter.length));

            if(query) {
              queriesSorted.push([query, this._filter_map[filter]]);
            }

            usingFilter = true;
            break;
          }
        }

        // No explicit filter
        if(!usingFilter) {
          queriesSorted.push([query]);
        }
      }

      return queriesSorted;
    },


    /**
     * Check that a given ticket matches a list of filters
     * @private
     * @memberof BacklogMilestone
     * @param {MilestoneTicket} ticket
     * @param {Array} queries - List of [queryTerm, filter] lists
     * @returns {Boolean} whether the ticket stasfies all queries
     */
    _ticket_satisfies_queries: function(ticket, queries) {
      var defaultFields = ["id", "summary"],
          defaultLength = defaultFields.length,
          passesTests = false,
          input, filter, i, field, f, j;

      for(i = 0; i < queries.length; i ++) {
        input = queries[i][0];
        filter = queries[i][1];
        passesTests = false;

        // Using a filter
        if(filter) {
          field = ticket.tData[filter[0]];
          f = this._get_filter(filter[1]);

          if(f(input, field)) {
            passesTests = true;
          }
        }
        else {
          for(j = 0; j < defaultLength; j ++) {
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

    /**
     * Remove this milestone from the backlog
     * @memberof BacklogMilestone
     * @param {Boolean} updateUrl - Whether to update the page's URL afterwards
     */
    remove: function(updateUrl) {
      this.remove_all_tickets();
      this.backlog._remove_milestone_references(this, updateUrl);
      this.$container.remove();

      if(this.$closeBtn) this.$closeBtn.tooltip("destroy");
      if(this.filterDeferred) this.filterDeferred.reject();
    },

    /**
     * Remove all tickets from a milestone
     * @memberof BacklogMilestone
     */
    remove_all_tickets: function() {
      var ticket;
      this.xhr.abort();

      for(ticket in this.tickets) {
        if(this.tickets.hasOwnProperty(ticket)) {
          this.tickets[ticket].remove();
        }
      }
    },

    /**
     * Enable the milestone's multi-picker
     * @memberof BacklogMilestone
     */
    multi_pick_enable: function() {
      this.$multiPick.removeClass("hidden");
      this.$selectionControls.removeClass("hidden");
    },

    /**
     * Disable the milestone's multi-picker
     * @memberof BacklogMilestone
     */
    multi_pick_disable: function() {
      this.$multiPick.addClass("hidden");
      this.$selectionControls.addClass("hidden");
    },

    /**
     * When the user starts to use the multi-picker (MP), called on mousedown.
     * Establishes mousemove event to set the MP level, and mouseup to process the selection
     * @memberof BacklogMilestone
     */
    multi_pick_start: function() {
      var _this = this,
          offset = this.$tktWrap.offset().top, maxHeight;

      this.mp_manual = true;
      this.$tBody.sortable("disable");

      if(!this.mpMinHeight) this.mpMinHeight = this.$multiPick.height();

      this.$mpPlaceholder.insertBefore(this.$multiPick);
      this.$multiPick.addClass("dragging");

      maxHeight = this.$tktWrap.height() + this.mpMinHeight;

      $(document).on("mousemove", function(e) {
        var height = Math.min(Math.max(_this.mpMinHeight, e.pageY - offset + (1.5*_this.mpMinHeight)), maxHeight);

        $("body").attr("unselectable", "on")
          .css("user-select", "none")
          .on("selectstart", false);

        _this.$multiPick.css("height", height);
      });
      $(document).one("mouseup", function() { _this.multi_pick_process(); });
    },

    /**
     * Selecting all tickets resembles the multi-pick functionality (move toggle to the bottom)
     * @memberof BacklogMilestone
     */
    multi_pick_all: function() {
      var mpHeight = this.$multiPick.height(),
          totalHeight = this.$tktWrap.height() + mpHeight;

      this.mpMinHeight = mpHeight;

      this.$tktWrap.scrollTop(this.$table.height());
      this.$mpPlaceholder.insertBefore(this.$multiPick);
      this.$multiPick.addClass("dragging").css("height", totalHeight);
      this.multi_pick_process(true);
    },

    /**
     * Process the multi-pick (MP) selection. If not all, manually check the MP
     * height against the tickets in the milestone until we reach a ticket not
     * covered by the MP.
     * @memberof BacklogMilestone
     * @param {Boolean} all - Whether to add all tickets into selection
     */
    multi_pick_process: function(all) {
      var _this = this,
          position, adjustedHeight;

      $(document).off("mousemove");
      $("body").removeAttr("unselectable")
               .removeAttr("style")
               .off("selectstart");

      // Calculate visible tickets below picker level
      if(!all) {
        position = this.$tktWrap.position().top;
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

    /**
     * Remove the multi-picker
     * @memberof BacklogMilestone
     * @param {Object} [e] - Event object
     */
    multi_pick_stop: function(e) {
      var event_type = e ? e.type : undefined;

      // When the user scrolls the a milestone's tickets container we remove the MP
      // selection. However, when a user selects all tickets we scroll to the bottom
      // of the container (mimicing selecting all using the MP). As these two situations
      // conflict, we use a switch mp_manual to prevent the MP from stopping when the
      // container was scrolled, but we aren't actually manually using it.
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

    /**
     * When moving multiple tickets into a new milestone, some tickets may fail
     * to pass validation. If this is the case, we show the error button and store
     * the list of errors.
     * @memberof BacklogMilestone
     * @param {Array} errors - List of [ticketId, ticketErrors] lists
     */
    multi_pick_show_errors: function(errors) {
      this._errors = errors;
      this.$mpErrorBtn.removeClass("hidden");
    },

    /**
     * When the user clicks on the error button, open the dialog
     * @memberof BacklogMilestone
     */
    multi_pick_show_errors_msg: function() {
      var errors = this._errors || [],
          errorLength = errors.length,
          $list = $("ul", this.backlog.$failDialog).html(""),
          i, j, ticketId, ticketErrors, $tErrors, $tList;

      this.backlog.$failDialog.data("_obj", this).dialog("open");

      for(i = 0; i < errorLength; i ++) {
        ticketId = errors[i][0];
        ticketErrors = errors[i][1];
        $tErrors = $("<li>Errors for ticket #"+ ticketId + "</li>").appendTo($list);
        $tList = $("<ul></ul>").appendTo($tErrors);

        for(j = 0; j < ticketErrors.length; j ++) {
          $tList.append("<li>" + ticketErrors[j] + "</li>");
        }
      }
    },

    /**
     * On closing the error dialog, remove the list of errors and hide the error button
     * @memberof BacklogMilestone
     */
    revert_error: function() {
      delete this._errors;
      this.$mpErrorBtn.addClass("hidden");
    },

    /**
     * Set the selection state to selected
     * @memberof BacklogMilestone
     */
    selection_selected: function() {
      this.$selectionToggleBtn.html("<i class='icon-check'></i>")
        .off("click")
        .on("click", $.proxy(this.multi_pick_stop, this))
        .attr("data-original-title", "Remove selection")
        .tooltip("fixTitle");
    },

    /**
     * Set the selection state to unselected
     * @memberof BacklogMilestone
     */
    selection_unselected: function() {
      this.mp_manual = false;
      this.$selectionToggleBtn.html("<i class='icon-check-empty'></i>")
        .off("click")
        .on("click", $.proxy(this.multi_pick_all, this))
        .attr("data-original-title", "Select all")
        .tooltip("fixTitle");
    },

    /**
     * Make a request to move all selected tickets to the milestone to the right
     * @memberof BacklogMilestone
     */
    move_selection: function() {
      var $move = $("i", this.$moveTicketsBtn),
          ticketChangetimes, ticketIds, neighbour, selectedId, xhr, ticket;

      if(!$move.hasClass("icon-spinner")) {
        ticketChangetimes = [];
        ticketIds = [];
        neighbour = this.$container.next().data("_self");

        $move.attr("class", "icon-spin icon-spinner");

        if(neighbour) {
          for(selectedId in this.mpSelection) {
            if(this.mpSelection.hasOwnProperty(selectedId)) {
              ticket = this.mpSelection[selectedId];
              ticketChangetimes.push(ticket.tData.changetime);
              ticketIds.push(ticket.tData.id);
            }
          }

          xhr = $.ajax({
            type: "POST",
            data: {
              "__FORM_TOKEN": window.formToken,
              "tickets": ticketIds.join(","),
              "changetimes": ticketChangetimes.join(","),
              "milestone": neighbour.name
            }
          });

          $.when(xhr).then($.proxy(this, "_move_selection_response", neighbour, $move));
        }
      }
    },

    /**
     * Process the move selection request from the server
     * @private
     * @memberof BacklogMilestone
     */
    _move_selection_response: function(neighbour, $move, data) {
      if(data.hasOwnProperty("errors")) {
        this.multi_pick_show_errors(data.errors);
      }

      neighbour.refresh(true);
      this.refresh(true);

      this.mp_running = false;
      $move.attr("class", "icon-chevron-right hidden");
    },

    /**
     * Initialise events for the milestone
     * @memberof BacklogMilestone
     */
    events: function() {
      this.$filter.on("keyup", $.proxy(this.filter_tickets, this));
      if(this.$closeBtn) this.$closeBtn.on("click", $.proxy(this.remove, this));

      if(this.backlog.editable) {
        this.$multiPick.on("mousedown", $.proxy(this.multi_pick_start, this));
        this.$tktWrap.on("scroll", $.proxy(this.multi_pick_stop, this));
      }
    }
  });


  // @namespace
  // MILESTONE TICKET PRIVATE CLASS DEFINITION
  // =========================================
  var MilestoneTicket = Class.extend({

    /**
     * Initialise a new ticket (invoked by a BacklogMilestone)
     * @constructor
     * @alias MilestoneTicket
     * @param {Backlog} backlog - Parent backlog
     * @param {BacklogMilestone} milestone - Parent milestone
     * @param {Object} tData - Ticket data
     */
    init: function(backlog, milestone, tData) {
      this.backlog = backlog;
      this.milestone = milestone;
      this.tData = tData;

      this.draw();
      this.events();

      this.milestone.tickets[tData.id] = this;
      this.backlog.tickets[tData.id] = this;

    },

    /**
     * Draw the ticket box
     * @memberof MilestoneTicket
     */
    draw: function() {
      var priority = $("<td/>").addClass('priority').attr('data-priority', this.tData.priority_value),
          id = $("<td/>").addClass('id').text("#" + this.tData.id),
          type = $("<td/>").addClass('type').attr('title', 'Type: ' + this.tData.type).text(
            this.tData.type.substring(0, 3)),
          summary = $("<td/>").addClass('summary').append(
            $("<a/>").attr('href', window.tracBaseUrl + 'ticket/' + this.tData.id).text(
              this.tData.summary));

      this.$container = $("<tr/>").append(priority, id, type, summary);

      this.$moveTopOption = $("<td class='move-to-top' title='Position ticket at top of milestone'>").appendTo(this.$container);
      this.$moveTop = $("<i class='icon-double-angle-up'></i>").appendTo(this.$moveTopOption);

      this.$moveBottomOption = $("<td class='move-to-bottom' title='Position ticket at bottom of milestone'>").appendTo(this.$container);
      this.$moveBottom = $("<i class='icon-double-angle-down'></i>").appendTo(this.$moveBottomOption);

      this.$moreOptions = $("<td class='more-options' title='More ticket options'>").appendTo(this.$container);
      this.$ticketOptions = $("<i class='icon-double-angle-right more-options'></i>").appendTo(this.$moreOptions);

      this.$pointsFeedback = $("<td class='storypoints' title='Story Points'></td>").appendTo(this.$container);
      this.$storyPoints = $("<span>" + this.tData.effort + "p</span>").appendTo(this.$pointsFeedback);

      this.$hoursFeedback = $("<td class='hours' title='Estimated Remaining Hours'></td>").appendTo(this.$container);
      this.$hours          = $("<span>" + pretty_time(this.tData.hours) + "</span>").appendTo(this.$hoursFeedback);
      this.$feedback        = $("<i class='hidden'></i>").appendTo(this.$hoursFeedback);

      this.$container.appendTo(this.milestone.$tBody).data("_self", this);
      $(".type, .hours, .storypoints, .move-to-top, .move-to-bottom, .more-options", this.$container).tooltip({
        placement: "top",
        container: "body"
      });
    },

    /**
     * Show the waiting logo during a ticket update
     * @memberof MilestoneTicket
     */
    show_wait: function() {
      this.$hours.addClass("hidden");
      this.$feedback.attr("class", "icon-spin icon-spinner");
    },

    /**
     * Hide the waiting logo after an update completes
     * @memberof MilestoneTicket
     */
    hide_wait: function() {
      this.$hours.removeClass("hidden");
      this.$feedback.attr("class", "hidden");
    },

    /**
     * Show an error icon if the ticket fails to save
     * @memberof MilestoneTicket
     */
    show_error: function(errors, tmpParent) {
      this._errors = errors || [];

      // Stop user from moving ticket further
      this.$container.addClass("ui-state-disabled");
      tmpParent.refresh_sortables();
      this.$hours.addClass("hidden");
      this.$feedback.attr("class", "icon-exclamation-sign color-warning");
    },

    /**
     * Open the error dialog to tell the user why the ticket failed
     * @memberof MilestoneTicket
     */
    show_error_msg: function() {
      var i;

      if(this.$feedback.hasClass("icon-exclamation-sign")) {
        this.backlog.$failDialog.dialog("open").data("_obj", this);
        var $list = $("ul", this.backlog.$failDialog).html("");

        for(i = 0; i < this._errors.length; i ++) {
          $list.append("<li>" + this._errors[i] + "</li>");
        }
      }
    },

    /**
     * On closing the error dialog, remove the error and move the ticket back
     * to it's original position
     * @memberof MilestoneTicket
     */
    revert_error: function() {
      var $milestoneTickets = $("tr:not(.none)", this.milestone.$tBody);
      $milestoneTickets.eq(this.$container.data("index")).before(this.$container);
      this.$container.removeClass("ui-state-disabled");
      this.milestone.refresh_sortables();
      this.hide_wait();
    },

    /**
     * Request to move an individual ticket
     * @memberof MilestoneTicket
     */
    save_changes: function() {
      var $next = this.$container.next(),
          $prev = this.$container.prev(),
          newParent = this.$container.parent().data("_self"),
          data = {
            "__FORM_TOKEN": window.formToken,
            "ticket": this.tData.id,
            "ts": this.tData.changetime
          }, xhr;

      this.show_wait();

      if($next.length) {
        data.relative_direction = "before";
        data.relative = $next.data("_self").tData.id;
      }
      else if($prev.length) {
        data.relative_direction = "after";
        data.relative = $prev.data("_self").tData.id;
      }

      if(newParent.name != this.milestone.name) {
        data.milestone = newParent.name;
      }

      xhr = $.ajax({
        type: "POST",
        data: data
      });

      $.when(xhr).then($.proxy(this, "_save_changes_response", newParent));
    },

    /**
     * Process the save request from the server
     * @memberof MilestoneTicket
     * @private
     */
    _save_changes_response: function(newParent, data) {
      if(data.hasOwnProperty("tickets")) {
        this.backlog.move_ticket(this, this.milestone, newParent);

        // Set empty message if the last ticket moved out of group
        if(this.milestone.length === 0) {
          this.milestone.set_empty_message();
          this.backlog.refresh_sortables();
        }

        this.milestone = newParent;

        // Update ticket data with new timestamp
        if(data.tickets.length == 1) this.tData = data.tickets[0];
      }

      if(!data.hasOwnProperty("errors")) {
        this.hide_wait();
      }
      else {
        this.show_error(data.errors, newParent);
      }
    },

    /**
     * Toggle the visibility of a ticket depending on the provided filter
     * @memberof MilestoneTicket
     * @param {Boolean} toggle - Whether to show the ticket or not
     */
    toggle_visibility: function(toggle) {
      this.$container.toggleClass("filter-hidden", !toggle);
    },

    /**
     * Initialise the ticket events
     * @memberof MilestoneTicket
     */
    events: function() {
      this.$feedback.on("click", $.proxy(this.show_error_msg, this));
      this.$moveTopOption.on("click", $.proxy(this.manually_move_ticket, this, 0, this.milestone.name));
      this.$moveBottomOption.on("click", $.proxy(function(){
        this.manually_move_ticket(this.milestone.length - 1, this.milestone.name);
        }, this)
      );
      this.$moreOptions.on("click", $.proxy(this.show_more_options, this));
      this.backlog.$moreOptions.off('change').on("change", "select", $.proxy(this.change_position_limits, this));
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

    /**
     * Remove the ticket and it's references at both the milestone and backlog levels
     * @memberof MilestoneTicket
     */
    remove: function() {
      this.backlog._remove_ticket_references(this);
      this.milestone._remove_ticket_references(this);
      this.$container.remove();
    },

    /**
     * Open the 'More Options' ticket dialog, setting various dynamic options 
       before initilization. Inside we use the HTML5 min, max and step 
       attributes to provide some basic client side validation.
     * @memberof MilestoneTicket
     */
    show_more_options: function() {
      var $optionsDialog = this.backlog.$moreOptions,
          maxPosition = this.milestone.length,
          // we add 1 as the index is 0 indexed - but we don't show this in the UI
          currentPosition = $("tr", this.$container.parent()).index(this.$container) + 1,
          currentMilestone = this.backlog.transform_milestone(this.milestone.name);

      $optionsDialog.find("label[for='desired-position']")
                    .text('Position (1-' + maxPosition + ")");
      $optionsDialog.find("select").select2('val', currentMilestone);
      $optionsDialog.find("input[name='position']").attr({
        value: currentPosition,
        step: 1,
        min: 1,
        max: maxPosition
      });

      $optionsDialog.dialog({
        title: "Move ticket " + this.tData.id,
        buttons: {
          Move: $.proxy(function() {
            var position = $optionsDialog.find("input[name='position']").val() - 1,
                milestone = $optionsDialog.find(":selected").val();
            this.manually_move_ticket(position, milestone);
          }, this),
          Close: function() {
            $(this).dialog("close");
          }
        }
      });

      $optionsDialog.dialog('open');
    },

    /**
     * Programatically sort the ticket order instead of using the drag and drop 
     functionality provided via jQuery sortable.
     * @memberof MilestoneTicket
     * @param {number} position - Position in milestone
     * @param {string} milestone - Milestone name
     */
    manually_move_ticket: function(position, milestone) {

      var $moreOptions = this.backlog.$moreOptions;

      // show new milestone if it is hidden and get class
      if (!this.backlog.milestones[milestone]) {
        this.backlog.add_milestone(milestone, true);
      }
      var $newMilestone = this.backlog.milestones[milestone],
          maxPosition = $newMilestone.length -1;

      if (position < 0 || position > maxPosition) {
        $moreOptions.dialog("close");
        this.show_priority_error(position + 1, $newMilestone.length);
      }
      else {
        var $tkt = $("tr", $newMilestone.$container).eq(position);
        if (position == maxPosition) {
          this.$container.insertAfter($tkt);
        }
        else {
          this.$container.insertBefore($tkt);
        }
        this.save_changes();
      }
      $moreOptions.dialog("close");
    },

    /**
     * Changes the HTML5 max attribute for the desired position number 
       input inside the more options dialog form. We set this after the 
       promise provided by the XHR request has been returned - so we can 
       accurately reflect the number of tickets per milestone in the UI.
     * @memberof MilestoneTicket
     * @private
     */
    change_position_limits: function(event) {
      var milestoneName = event.val;

      // for this to work the milestone must be displayed
      if (!this.backlog.milestones[milestoneName]) {
        this.backlog.add_milestone(milestoneName, true);
      }

      if(this.backlog.milestones[milestoneName]) {
        var $milestone = this.backlog.milestones[milestoneName];
        // wait for the deferred object to return a promise
        $.when( $milestone.refresh(true) ).done(
          $.proxy( function(){
            this.backlog.$moreOptions.find("input[name='position']").attr({
              max: $milestone.length,
            });
            this.backlog.$moreOptions.find("label[for='desired-position']")
                                     .text('Position (1-' + $milestone.length + ")");
          }, this)
        );
      }
    },

    /**
     * Open the failDialog to inform user why the attempt to move a ticket failed.
     * @memberof MilestoneTicket
     * @private
     * @param {number} position - The position a user tried to move the ticket to
     * @param {number} max - The maximum position accepted
     */
    show_priority_error: function(position, max) {
      var $list = $("ul", this.backlog.$failDialog).html("");
      $list.append("<li>Cannot move ticket to position " + position + ". " +
                  "You must specify a position between 1 and " + max + ".</li>");
      this.backlog.$failDialog.dialog("open");
    }

  });

  /**
   * Convert floating-point hours to user friendly representation
   * @param {Number} float_time
   */
  function pretty_time(float_time) {
    var hours = Math.floor(float_time),
        minutes = Math.floor((float_time - hours) * 60),
        result, pad;

    if(hours || minutes) {
      result = hours + "h";

      if(minutes) {
        pad = "0" + minutes.toString();
        result += pad.substring(pad.length - 2) + "m";
      }
    }
    else {
      result = "0h";
    }
    return result;
  }

  /**
   * Retrieve the default milestones, by trying to find ones set in the URL, and
   * falling back to the most recent ones if not found
   */
  function milestones_from_query() {
    var query = $.QueryString,
        initials = [], topLevel, firstMilestone;

    if("m" in query) {
      initials = (query.m instanceof Array) ? query.m : [query.m];
    }

    else {
      topLevel = window.milestones.results;
      initials.push("");

      if(topLevel.length > 1) {
        firstMilestone = topLevel[1];
        initials.push(firstMilestone.text);

        if(firstMilestone.children.length > 0) {
          initials.push(firstMilestone.children[0].text);
        }
      }
      return initials;
    }

    return initials;
  }

  /*
   * Simple method to break down a query string into components
   * Inspired by http://stackoverflow.com/a/3855394/1773904
   * If multiple keys found, value is converted into an array
   * To check if a key exists, use "foo" in $.QueryString
   * This is because a key can exist without a value.
   */
  if(History) {
    $.QueryString = (function(unsorted) {
      var i, length = unsorted.length,
          sorted = {}, query, name, value;

      if(unsorted[0] === "") return sorted;
      for(i = 0; i < length; i ++) {
        query = unsorted[i].split("=");
        name = query[0];
        value = query[1];

        if(value !== undefined) value = decodeURIComponent(value.replace(/\+/g, " "));

        if(name in sorted) {
          if(!(sorted[name] instanceof Array)) {
            sorted[name] = [sorted[name]];
          }
          sorted[name].push(value);
        }
        else {
          sorted[name] = value;
        }
      }
      return sorted;
    })((History.getState().hash.split("?")[1] || "").split("&"));
  }

}(window.jQuery, window.Class, window.History));