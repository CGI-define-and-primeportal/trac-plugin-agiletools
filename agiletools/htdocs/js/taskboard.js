/* =============================================================================
 * taskboard.js
 * =============================================================================
 * @author Ian Clark
 * @copyright CGI 2014
 * @file A live, agile task board for Trac, enabling users to drag and drop
 * tickets into different statuses. Unlike traditional task boards, tickets can
 * also be grouped by all disrete-value fields (such as owner, component etc.),
 * and where a large number of possible values exist, the view is automatically
 * filtered to show only the most popular values (this can be manually tweaked
 * by the user). The task board regularly polls for changes, and remote ticket
 * changes are animated across the board. The user can also toggle the view
 * mode between condensed (default) and expanded, and a fullscreen mode.
 * Tickets ordering: 'position' ASC (see backlog), 'priority' DESC, 'id' DESC.
 * =============================================================================
 * @requires jQuery (> 1.7)
 * @requires jQuery UI Draggable & Droppable (> 1.10)
 * @requires Resig's Simple Inheritence Model (http://goo.gl/lWUkve)
 * ========================================================================== */

(function($, Class) { "use strict";

  var taskboard,
      isChrome = "chrome" in window,
      isWindows = navigator.userAgent.toLowerCase().indexOf("windows") != -1;

  // DOCUMENT READY CALL
  // ===================
  $(document).ready(function() {
    var $container = $("#taskboard-container"), workflows;

    // Only instantiate the taskboard if we have ticket data
    if(window.tickets) {
      taskboard = new Taskboard("taskboard", $container, window.groupName,
                                window.groups, window.tickets, window.currentWorkflow);

      init_popovers();
      init_filters(taskboard);
      if(taskboard.filtered) show_filter_msg($container);

      if(window.groupName == "status") {
        workflows = taskboard.get_workflows();
        if(workflows.length > 1) show_workflow_controls(workflows);
      }

      $("#taskboard-controls").addClass("visible");
      $("#btn-stat-fields").on("click", event_toggle_stat_fields);
      $("#btn-switch-view").on("click", event_toggle_condensed);
      $("#btn-fullscreen").on("click", event_toggle_fullscreen);
    }
    else {
      show_no_ticket_msg($container);
    }

    event_change_query();

    // TICKET DIALOG
    // =============

    var $t_dialog = $("#ticket-dialog"),
        $show_comments_markup = $('<p>').append('<i class="fa fa-angle-down"></i> Show comments \
                                <i class="fa fa-angle-down"></i>'),
        $hide_comments_markup = $('<p>').append('<i class="fa fa-angle-up"></i> Hide comments \
                                <i class="fa fa-angle-up"></i>');

    $("#taskboard").on('click', '.ticket', function(e){

      // only prevent default if left-click fired
      if (e.button === 0) {
        e.preventDefault();

        var $ticket = $(this).closest('.ticket'),
            ticket_id = $ticket.attr('id').replace('ticket-', ''),
            ticket_summary = $ticket.find('a').html(),
            opt = {
              autoOpen: false,
              modal: true,
              width: 600,
              height: 500
            },
            dialog = $t_dialog.dialog(opt);

        // let the dialog title render HTML 
        // stackoverflow.com/questions/4103964
        dialog.data( "uiDialog" )._title = function(title) {
          title.html( this.options.title );
        };

        // set the title now it supports HTML markup
        $t_dialog.dialog('option', 'title', '<a title="Go to ticket #' + ticket_id + '" href=' + 
              window.tracBaseUrl + 'ticket/' + ticket_id + '>' + ticket_summary + '</a>');

        // reset the background styling of all other ticket divs
        $(".ticket").removeClass("grey-background");
        // set the colour of selected div so the user can see where it is on the board
        $ticket.addClass("grey-background");

        // show a loading spinner while we wait for the response
        $t_dialog.html("<div class='row-fluid'>\
          <i id='ticket-dialog-spinner' class='col-xs-12 ticket-dialog-spinner \
            fa fa-spinner fa-spin fa-2x'></i>\
            <p id='ticket-dialog-text' class='col-xs-12'>Fetching ticket details</p>\
            </div>")

        $.ajax({
          type: 'GET',
          url: window.tracBaseUrl + 'ticket/' + ticket_id,
          data: {'preview': true},
          success: function(data) {
            $t_dialog.html($(data).find('#ticket'));
            $t_dialog.append('<div class="row-fluid"><p id="show-comments" \
              class="col-xs-12">' + $show_comments_markup.html() + '</div>');
            $t_dialog.append('<div id="ticket-changes" class="hidden"></div>');
            $("#ticket-changes").html($(data).find("#changelog"));
          }
        });

        dialog.dialog('open');
      }
    });

    // Catch the event when a user closes the ticket-dialog
    $t_dialog.on('dialogclose', function() {
     $(".ticket").removeClass('grey-background');
    });

    // Catch the event when a user clicks 'Show comments' element in ticket-dialog
    $t_dialog.on('click', '#show-comments', function() {
      $("#ticket-changes").slideToggle(400, function() {
        if ($("#ticket-changes").is(":visible")) {
          $("#show-comments").html($hide_comments_markup.html());
        } else {
          $("#show-comments").html($show_comments_markup.html());
        }
      });
    });

    /**
     * When a user clicks the 'Set as default' ribbon icon, we send an 
     * ajax request to /taskboard/set-default-query with the current 
     * milestone and group parameter values as data
    */

    $("#set-default-query").on("click", function(e){
      if (!$(this).hasClass('disabled')) {

        // DOM elements we need to replicate a bootstrap alert box
        var $alert_wrapper = $("<div/>").addClass("cf alert alert-dismissable individual");
        var $alert_icon = $("<i/>").addClass("fa fa-info-circle");
        var $alert_text = $("<div/>").css({"display": "inline", "padding": "10px"})
        var $alert_button = $("<button/>").addClass("close btn btn-mini")
                                          .attr({"type": "button", "data-dismiss": "alert"})
                                          .prepend(($("<i/>").addClass("fa fa-times")));

        // set milestone and group values in form
        $("#default-query-form input[name='milestone']").val(milestone);
        $("#default-query-form input[name='group']").val(group);
        // find the checked inputs in the display fields node
        var col = $("#mods-columns input:checked").map(function(i,el){return el.value;}).get()
        $("#default-query-form input[name='col']").val(col);
        var view = $("#content").hasClass("view-condensed") ? "condensed" : "expanded";
        $("#default-query-form input[name='view']").val(view)

        $.ajax({
          type: 'POST',
          url: window.tracBaseUrl + 'taskboard/set-default-query',
          data: $("#default-query-form").serialize(),
          success: function() {

            $alert_wrapper.addClass("alert-success");
            $alert_text.text("Default query saved");
            $alert_wrapper.append($alert_icon)
                          .append($alert_text)
                          .append($alert_button);

            $("#content").prepend($alert_wrapper);
            $("#set-default-query").addClass("disabled");
          },
          error: function() {

            $alert_wrapper.addClass("alert-danger");
            $alert_text.text("Unable to save default query");
            $alert_wrapper.append($alert_icon)
                          .append($alert_text)
                          .append($alert_button);

            $("#content").prepend($alert_wrapper);
          }
        })
      }
    });

  });


  // @namespace
  // TASKBOARD PUBLIC CLASS DEFINITION
  // =================================
  var Taskboard = $.LiveUpdater.extend({

    /**
     * Initialise a new task board
     * @constructor
     * @alias Taskboard
     * @param {string} id - The HTML ID attribute to give the task board
     * @param {JQuery} $container - The container to create the task board in
     * @param {string} groupBy - The field to group the task board by
     * @param {Object} groupData - The group data
     * @param {Object} ticketData - The ticket data
     * @param {string} [defaultWorkflow] - The initial workflow to show
     */
    init: function(id, $container, groupBy, groupData, ticketData, defaultWorkflow) {
      this.id = id;
      this.groupBy = groupBy;

      this.$container = $container;
      this.draw_table();
      this.draw_dialogs();

      this.construct(groupData, ticketData, defaultWorkflow);
    },

    /**
     * Construct the task board, given group & ticket data, and optional workflow
     * @memberof Taskboard
     * @param {Object} groupData - The group data
     * @param {Object} ticketData - The ticket data
     * @param {string} [workflow] - The workflow to show
     */
    construct: function(groupData, ticketData, workflow) {
      var groupName, ticketsInGroup, i;

      this.groupData = groupData;
      this.ticketData = ticketData;
      this.workflow = workflow;

      // Once instantiated, we keep track of our groups and tickets via these objects
      this.groups = {};
      this.groupsOrdered = [];
      this.tickets = {};

      this.set_data_object(this.workflow);

      // If grouping by status, keep a map of ticket IDs to workflow and status
      if(this.groupBy == "status") this._construct_ticket_map();

      this.ticketCount = this.groupCount = 0;

      // Instantiate groups
      for(i = 0; i < this.curGroupData.length; i ++) {
        groupName = this.curGroupData[i];
        ticketsInGroup = this.curTicketData[groupName] || {};

        this.groupsOrdered[i]  =
        this.groups[groupName] = new Group(this, groupName, i, ticketsInGroup);
      }

      this.update_ticket_counts();
      this.filter_groups();
      this.init_updates();
    },

    /**
     * Draw the actual task board table
     * @memberof Taskboard
     */
    draw_table: function() {
      this.$el = $("<table id='"+this.id+"'>" +
                    "<thead><tr></tr></thead>" +
                    "<tbody><tr></tr></tbody>" +
                  "</table>");
      this.$container.append(this.$el);
    },

    /**
     * Draw the dialogs for additional options and for ticket save fail description
     * @memberof Taskboard
     */
    draw_dialogs: function() {
      var _this = this;

      this.$optDialog = $("<form id='" + this.id + "-op-dialog' class='hidden'></form>");
      this.$failDialog = $("<div id='" + this.id + "-fail-dialog' class='hidden'>" +
                            "Your ticket failed for the following reasons:" +
                            "<ul></ul>" +
                          "</div>");

      this.$container.append(this.$optDialog, this.$failDialog);

      this.$optDialog.dialog({
        modal: true,
        autoOpen: false,
        close: function() {
          var ticket;

          if(_this.$optDialog.data("done")) {
            _this.$optDialog.data("done", false);
          }
          else {
            ticket = _this.$optDialog.data("ticket");
            if(ticket) ticket.group.drop_in_place(ticket);
          }
          _this.reset_droppables();
        },
        buttons: {
          Cancel: function() { $(this).dialog("close"); },
          Save: function() {
            var $dialog = $(this),
                ticket = $dialog.data("ticket"),
                newGroup = $dialog.data("group");

            _this.process_move(ticket, newGroup, true);
            $dialog.data("done", true).dialog("close");
          }
        }
      });

      this.$failDialog.dialog({
        modal: true,
        autoOpen: false,
        title: "Failed to save ticket",
        close: function() {
          var ticket = $(this).data("ticket");
          ticket.hide_wait();
          ticket.animate_move(true);
        },
        buttons: {
          Close: function() { $(this).dialog("close"); }
        }
      });
    },

    /**
     * When we're viewing tickets by status, we can't show multiple workflows at
     * once, so the structure of tickets/groups is different. This interface
     * returns the same structure for all group-by options
     * @memberof Taskboard
     * @param {string} [workflow] - The workflow get data for
     */
    set_data_object: function(workflow) {
      if(workflow) {
        this.curTicketData = this.ticketData[workflow];
        this.curGroupData = this.groupData[workflow];
      }
      else {
        this.curTicketData = this.ticketData;
        this.curGroupData = this.groupData;
      }
    },

    /**
     * When grouping by Status, we want to avoid costly nested loops whenever
     * we get an update. Therefore we construct a map so that when we receive
     * an update to a ticket, we use the map to find it's old workflow and group
     * @private
     * @memberof Taskboard
     */
    _construct_ticket_map: function() {
      var workflow, group, ticket;

      this.ticketMap = {};

      for(workflow in this.ticketData) {
        if(this.ticketData.hasOwnProperty(workflow)) {

          for(group in this.ticketData[workflow]) {
            if(this.ticketData[workflow].hasOwnProperty(group)) {

              for(ticket in this.ticketData[workflow][group]) {
                if(this.ticketData[workflow][group].hasOwnProperty(ticket)) {
                  this.ticketMap[ticket] = [workflow, group];
                }
              }
            }
          }
        }
      }
    },

    /**
     * Collect workflow names from the ticket data
     * @memberof Taskboard
     */
    get_workflows: function() {
      var workflows = [], workflow;

      if(this.groupBy == "status") {
        for(workflow in this.ticketData) {
          if(this.ticketData.hasOwnProperty(workflow)) workflows.push(workflow);
        }
      }

      return workflows;
    },

    /**
     * Returns a nested-list of groups and their number of tickets
     * @memberof Taskboard
     * @returns {Array} [[<group>, <group-count>], ...]
     */
    order_groups_by_count: function() {
      var i = 0,
          byCount = [], groupName, group, pos, j;

      for(groupName in this.groups) {
        if(this.groups.hasOwnProperty(groupName)) {
          group = this.groups[groupName];
          pos = -1;

          for(j = 0; j < i; j ++) {
            if(group.ticketCount > byCount[j][1]) {
              pos = j;
              break;
            }
          }
          if(pos > -1) {
            byCount.splice(j,0,[group, group.ticketCount]);
          }
          else {
            byCount.push([group, group.ticketCount]);
          }
          i ++;
        }
      }
      return byCount;
    },

    /**
     * Filter the groups to only show a selection of them.
     * If no groups supplied, show the most popular 8
     * @memberof Taskboard 
     * @param {Array} [groups] - List of groups to show
     */
    filter_groups: function(groups) {
      var x = 8, byCount, i, group, groupName, visible, filterLength;

      if(!groups) {
        if(this.groupCount > x) {
          byCount = this.order_groups_by_count();

          for (i = 0; i < this.groupCount; i ++) {
            group = byCount[i][0];

            if(i < x) {
              group.filter_show();
            }
            else {
              group.filter_hide();
            }
          }
          this.filtered = true;
        }

        // If no group set, and no need to filter, show all
        else {
          for(groupName in this.groups) {
            if(this.groups.hasOwnProperty(groupName)) {
              this.groups[groupName].filter_show();
            }
          }
          this.filtered = false;
        }
      }

      // If user specified filter, group instances need to be collected
      else {
        for(groupName in this.groups) {
          if(this.groups.hasOwnProperty(groupName)) {
            visible = false;
            filterLength = groups.length;

            group = this.groups[groupName];

            for(i = 0; i < filterLength; i ++) {
              if(group.name == groups[i]) {
                visible = true;
                break;
              }
            }

            if(visible) group.filter_show();
            else group.filter_hide();
          }
        }
        this.filtered = true;
      }
    },

    /**
     * Add a group to the filter
     * @memberof Taskboard
     * @param {string} groupName
     */
    filter_add: function(groupName) {
      this.groups[groupName].filter_show();
    },

    /**
     * Remove a group from the filter
     * @memberof Taskboard
     * @param {string} groupName
     */
    filter_remove: function(groupName) {
      this.groups[groupName].filter_hide();
    },

    /**
     * Called when dragging starts.
     * Restricts the user from moving the current ticket to certain groups
     * @memberof Taskboard
     * @param {Ticket} ticket
     */
    set_valid_moves: function(ticket) {
      var groupName, actions;

      if(this.groupBy == "status") {
        actions = ticket.tData.actions;

        for(groupName in this.groups) {
          if(!actions.hasOwnProperty(groupName)) {
            this.groups[groupName].$elBody.droppable("disable").addClass("disabled");
          }
        }
      }
      ticket.group.$elBody.droppable("disable")
                         .removeClass("disabled");
    },

    /**
     * Process a ticket move request
     * @memberof Taskboard
     * @param {Ticket} ticket
     * @param {Group} newGroup
     * @param {Boolean} fromDialog - If follow up request (after request for additional info)
     */
    process_move: function(ticket, newGroup, fromDialog) {
      if(this.groupBy == "status") {
        this._process_status_move(ticket, newGroup, fromDialog);
      }
      else {
        this._process_generic_move(ticket, newGroup);
      }
    },

    /**
     * Process a ticket move when grouping by all other than status
     * @private
     * @memberof Taskboard
     */
    _process_generic_move: function(ticket, newGroup) {
      var data = { "value" : newGroup.name };
      this._save_ticket_change(ticket, data, false);
    },

    /**
     * Process a ticket move when grouping by status. If not from
     * dialog we first check to see if any additional actions are required for
     * this status. If there are, we open the dialog and prompt a response.
     * @private
     * @memberof Taskboard
     */
    _process_status_move: function(ticket, newGroup, fromDialog) {
      var action, data, i, operation;

      if(ticket.tData.actions.hasOwnProperty(newGroup.name)) {
        action = ticket.tData.actions[newGroup.name];
        data = { action: action[0] };

        if(!fromDialog) {
          for(i = 0; i < action[1].length; i ++) {
            operation = action[1][i];

            if(window.operationOptions.hasOwnProperty(operation)) {
              this.set_options(ticket, newGroup, window.operationOptions[operation]);
              return;
            }
          }
          this._save_ticket_change(ticket, data, false);
        }
        else {
          this._save_ticket_change(ticket, data, true);
        }
      }
    },

    /**
     * Process checks complete: make the Ajax request to save the ticket
     * @private
     * @memberof Taskboard
     */
    _save_ticket_change: function(ticket, newData, fromDialog) {
      var url = window.tracBaseUrl + "taskboard", xhr,
          data = {
            "__FORM_TOKEN": window.formToken,
            "group_name": this.groupBy,
            "ticket": ticket.id,
            "ts": ticket.tData._changetime
          };

      $.extend(data, newData);

      ticket.freeze();

      // Add our dialog inputs to our post list
      if(fromDialog) {
        $("input, select", this.$optDialog).each(function() {
          data[$(this).attr("name")] = $(this).val();
        });
      }

      xhr = $.post(url, data);

      $.when(xhr).then(
        $.proxy(this, "_save_ticket_response", ticket),
        $.proxy(this, "_save_ticket_fail", ticket)
      );
    },

    /**
     * Retrieve the response from the server, and process for success / errors
     * @private
     * @memberof Taskboard 
     */
    _save_ticket_response: function(ticket, data) {
      if(data.error) {
        ticket.save_failed_feedback(data.error);
      }
      else {
        this.process_update(data);
      }
    },

    /**
     * The server failed to respond appropriately, try to find out why
     * @private
     * @memberof Taskboard 
     */
    _save_ticket_fail: function(ticket, jqXHR) {
      var errors = [jqXHR.status + ": " + jqXHR.statusText],
          $feedback = $(jqXHR.responseText).contents().find("#content.error"),
          $errorCode = $(".message pre", $feedback);

      if($errorCode.length) {
        errors.push("Error code: " + $errorCode.html());
      }
      ticket.save_failed_feedback(errors);
    },

    /**
     * Process an update from the server. UI response depends on whether
     * triggered by the user (i.e. after a save request). Deal with adding and
     * removing tickets which have changed their scope (i.e. a milestone change)
     * @memberof Taskboard
     * @param {Object} data - JSON object returned by the server
     *   @param {Object} [data.ticket] - Ticket information
     *   @param {Object} [data.opts - Additional options
     *   @param {Array}  [data.otherChanges] - ticket IDs which have changed but are not in scope
     * @param {string} [textStatus] 
     * @param {jqXHR} [jqXHR]
     */
    process_update: function(data) {
      var byUser = arguments.length == 1,
          workflow, existingData, newData, op, i, ticketId;

      if(data.tickets) {

        // Process each workflow's data when grouped by status
        if(this.groupBy == "status") {
          for(workflow in this.ticketData) {
            if(this.ticketData.hasOwnProperty(workflow)) {
              existingData = this.ticketData[workflow];
              newData = data.tickets[workflow];

              this._process_update_tickets(byUser, existingData, newData, workflow);
            }
          }
        }

        else {
          this._process_update_tickets(byUser, this.ticketData, data.tickets);
        }

        // Processed ticket data, now refreshO group's ticket counts in the UI
        this.update_ticket_counts();
      }

      if(data.ops) {
        for(op in data.ops) {
          if(data.ops.hasOwnProperty(op)) {
            window.operationOptions[op] = data.ops[op];
          }
        }
      }

      // If a ticket is changed outside of our current query's scope, then we need
      // To check if it's currently in our taskboard, and if it is, remove it.
      if(data.otherChanges) {
        for(i = 0; i < data.otherChanges.length; i ++) {
          ticketId = data.otherChanges[i];

          if(this.tickets[ticketId]) this.tickets[ticketId].remove();
          this._remove_ticket_data(ticketId);
        }
      }
    },

    /**
     * Process ticket updates for a series of group data. Here, we deal with
     * both retaining knowledge at the Taskboard level as well as using that
     * info to instantiate / remove and Ticket instances as needed. When grouped
     * by status, ticket data has an additional outer layer for each workflow.
     * we only show one workflow at a time, but we need to retain the info for
     * all workflows.
     * @private
     * @memberof Taskboard
     * @param {Boolean} byUser - User invoked update (i.e. by moving a ticket)
     * @param {Object} newData - The new 
     */
    _process_update_tickets: function(byUser, existingData, newData, workflow) {
      var group, ticketId, existingTicket, ticketData, newGroup;

      for(group in newData) {
        if(newData.hasOwnProperty(group)) {

          for(ticketId in newData[group]) {
            if(newData[group].hasOwnProperty(ticketId)) {

              // Delete Taskboard data about this ticket and update the map
              // Let jQuery handle complex merging of new & old data at the end.
              this._remove_ticket_data(ticketId);
              if(workflow) this.ticketMap[ticketId] = [workflow, group];

              existingTicket = this.tickets[ticketId];

              // If we're not grouping by status, or we are and this information
              // pertains to the current workflow, add / remove Ticket instances
              if(!workflow || workflow == this.workflow) {
                ticketData = newData[group][ticketId];
                newGroup = this.groups[group];

                // If the new group exists
                if(newGroup) {

                  // If we haven't seen this ticket before
                  if(!existingTicket) {
                    this.tickets[ticketId] = new Ticket(newGroup, ticketId, ticketData);
                    this.ticketCount ++;
                  }

                  // If we have, and we didn't previously know about this update
                  else if(existingTicket.tData._changetime != ticketData._changetime) {
                    existingTicket.update(ticketData, byUser, newGroup);
                  }
                }

                // We've never seen this group before, reload taskboard entirely
                else {
                  this.refresh();
                }
              }

              // If grouping by status, and ticket has moved out of the active
              // workflow (i.e. it's been retyped) -> remove it.
              else if(existingTicket) {
                existingTicket.remove();
              }
            }
          }
        }
      }

      // Finally, update the existing data with the new data
      $.extend(true, existingData, newData);
    },

    /**
     * A single interface to remove the ticket data at the Taskboard level.
     * When grouping by status the ticket might not be instantiated, so we use
     * our map as a failsafe way of getting it's workflow / group. Otherwise,
     * we just locate our Ticket instance and use that to find the group.
     * @private
     * @memberof Taskboard
     * @param {Number} ticketId - The ticket ID to look for and remove
     */
    _remove_ticket_data: function(ticketId) {
      var ticketInfo, workflow, group, ticket;

      if(this.groupBy == "status") {
        ticketInfo = this.ticketMap[ticketId];

        if(ticketInfo) {
          workflow = ticketInfo[0];
          group = ticketInfo[1];
          delete this.ticketData[workflow][group][ticketId];
          delete this.ticketMap[ticketId];
        }
      }

      else {
        ticket = this.tickets[ticketId];
        delete this.ticketData[ticket.group.name][ticketId];
      }
    },

    /**
     * Loop through every group and ask them to recalculate their number of tickets
     * @memberof Taskboard
     */
    update_ticket_counts: function() {
      for(var groupName in this.groups) {
        if(this.groups.hasOwnProperty(groupName)) {
          this.groups[groupName].update_ticket_count();
        }
      }
    },

    /**
     * Open a dialog displaying the required operation required before a ticket
     * can move into a new group (for status changes)
     * @memberof Taskboard
     * @param {Ticket} ticket
     * @param {Group} newGroup
     * @param {Array} operation - [<action>, <action label>, <input HTML>, <outcome label>]
     */
    set_options: function(ticket, newGroup, operation) {
      this.$optDialog.html(operation[2])
        .dialog({ title: operation[1] })
        .dialog("open")
        .data({
          ticket: ticket,
          group: newGroup
        });
      $('.user-field').userField();

      $("select", this.$optDialog).select2({
        width: "off",
        dropdownCssClass: "ui-dialog",
        adaptContainerCssClass: function() { return null; }
      });
    },

    /**
     * Re-enable all droppables (groups)
     * @memberof Taskboard
     */
    reset_droppables: function() {
      for(var group in this.groups) {
        if(this.groups.hasOwnProperty(group)) {
          this.groups[group].$elBody.droppable("enable").removeClass("over disabled");
        }
      }
    },

    /**
     * Completely refresh the task board. Useful when minute differences are not picked up
     * @memberof Taskboard
     * @param {Boolean} [notify] - whether to make the update evident to the user
     * @returns {Promise}
     */
    refresh: function(notify) {
      var xhr = $.ajax();

      if(notify) {
        this.$loadMsg = $("<div class='taskboard-refresh'>" +
                          "<i class='fa fa-refresh fa-spin color-info'></i>" +
                          "</div>").appendTo(this.$container);
      }

      $.when(xhr).then($.proxy(this, "_refresh_success"),
                       $.proxy(this, "_refresh_fail"));

      return xhr.promise();
    },

    /**
     * Once the Deferred is resolved, tear the task board down and rebuild
     * @private
     * @memberof Taskboard
     */
    _refresh_success: function(data) {
      var _this = this;

      // Throw all of our data into the window object
      $.extend(window, data);

      this.teardown();
      this.construct(data.groups, data.tickets, data.currentWorkflow);

      if(this.$loadMsg) {
        $.wait(1000).then(function() {
          _this.$loadMsg.fadeOut(function() {
            _this.$loadMsg.remove();
            delete _this.$loadMsg;
          });
        });
      }
    },

    /**
     * If the Deferred is rejected, reload the page altogether
     * @private
     * @memberof Taskboard
     */
    _refresh_fail: function() {
      window.location.reload();
    },

    /**
     * Construct a new taskboard given a workflow
     * @memberof Taskboard
     * @param {string} workflow - The name of the workflow to draw
     */
    change_workflow: function(workflow) {
      if(this.ticketData[workflow]) {
        var groupData = this.groupData,
            ticketData = this.ticketData;

        this.teardown();
        this.construct(groupData, ticketData, workflow);
      }
    },

    /**
     * Teardown the taskboard, removing all group and ticket models and DOM elements
     * @memberof Taskboard
     */
    teardown: function() {
      var ticket, groupName;

      for(ticket in this.tickets) {
        if(this.tickets.hasOwnProperty(ticket)) {
          this.tickets[ticket].remove();
        }
      }

      for(groupName in this.groups) {
        if(this.groups.hasOwnProperty(groupName)) {
          this.groups[groupName].remove();
        }
      }

      delete this.tickets;
      delete this.ticketData;
      delete this.groups;
      delete this.groupsOrdered;
      delete this.groupData;
      clearTimeout(this.updateTimeout);
    }
  });


  // @namespace
  // GROUP PRIVATE CLASS DEFINITION (INSTANTIATED BY TASKBOARD)
  // ==========================================================
  var Group = Class.extend({

    /**
     * Initialise a new group
     * @constructor
     * @alias Group
     * @param {Taskboard} taskboard - Linked to this task board
     * @param {string} name - The name of the new group
     * @param {Number} order - the order of the group within the task board
     * @param {Object} ticketData - the data used to initialise this group's tickets
     */
    init: function(taskboard, name, order, ticketData) {
      this.taskboard = taskboard;
      this.name = name;
      this.order = order;
      this.ticketData = ticketData;

      this.taskboard.groupCount ++;
      this.ticketCount  = 0;
      this.ticketHours  = 0;
      this.ticketEffort = 0;

      this.maxCount = 0;

      if(window.statusLimits) {
        this.maxCount = window.statusLimits[this.name] || 0;
      }

      this.draw_elems();
      this.set_events();
    },

    /**
     * Draw both the header and the body of this group
     * @memberof Group
     */
    draw_elems: function() {
      this._draw_head();
      this._draw_body();
    },

    /**
     * Draw the group header, including an avatar if available
     * @private
     * @memberof Group
     */
    _draw_head: function() {
      var avatar = (((window.userData||{})[this.name]||{})).avatar;

      this.$elHead = $("<th class='cf'></th>");

      if(avatar) {
        this.$elHead.append("<img class='hidden-phone group-avatar' src='" + avatar + "' a />");
      }

      this.countClasses = "group-count hidden-phone";
      this.$elHead.append("<div class='" + this.countClasses + "'>" +
			  "<i class='fa fa-ticket'></i> <span class='tickets'></span>" +
			  "<i class='margin-left-small fa fa-bars'></i> <span class='effort'></span>" +
			  "<i class='margin-left-small fa fa-clock-o'></i> <span class='hours'></span>" +
			  "</div>");

      
      this.$elHead.append("<div class='group-name'>" + this.get_visual_name() + "</div>");
      $("thead tr", this.taskboard.$el).append(this.$elHead);
    },

    /**
     * Draw the body of the group. Loop over ticketData, instantiate new Ticket for each.
     * @private
     * @memberof Group
     */
    _draw_body: function() {
      var ticketId;

      this.$elBody = $("<td class='tickets'></td>");

      this.$elBody.data("_self", this);
     
      // we need to add an extra div, as table cells take up the height of 
      // their contents according to CSS spec - which would ignore the height
      // property needed by oveflow: scroll/auto
      var ticket_wrapper = "<div class='tickets-wrap'></div>"
      if (this.$elBody.children().length) {
        this.$elBody.children().wrapAll(ticket_wrapper);
      }
      else {
        this.$elBody.append(ticket_wrapper);
      }

      // make the tickets-wrap element available later
      this.$elWrapper = this.$elBody.find(".tickets-wrap")

      for(ticketId in this.ticketData) {
        if(this.ticketData.hasOwnProperty(ticketId)) {
          this.taskboard.tickets[ticketId] = new Ticket(this, ticketId, this.ticketData[ticketId]);
        }
      }

      $("tbody tr", this.taskboard.$el).append(this.$elBody);


    },

    /**
     * Set the droppable events for this group
     * @memberof Group
     */
    set_events: function() {
      var _this = this;

      this.$elBody.droppable({
        accept: "div.ticket",
        over: function() {
          $(this).addClass("over");
        },
        out: function() {
          $(this).removeClass("over");
        },
        drop: function(e, ui) {
          var ticket = ui.draggable.data("_self");
          _this.drop_in_place(ticket);
          _this.taskboard.process_move(ticket, _this);
        }
      });
    },

    /**
     * Show this group - invoked by Taskboard
     * @memberof Group
     */
    filter_show: function() {
      this.visible = true;
      this.$elHead.add(this.$elBody).removeClass("hidden");
    },

    /**
     * Hide this group - invoked by Taskboard
     * @memberof Group
     */
    filter_hide: function() {
      this.visible = false;
      this.$elHead.add(this.$elBody).addClass("hidden");

      // IE8 hack to support thead and tbody auto resizing when a column is hidden.
      // Taken from stackoverflow.com/q/2654103. If you are confused by 
      // the use of setTimeout() recommend you read stackoverflow.com/q/779379
      var taskboard = this.taskboard.$el;
      taskboard.css("display", "inline-table");
      window.setTimeout(function(){ taskboard.css("display", ""); }, 0);
    },

    /**
     * Get the visual name for a group. If grouped by a user field, we try to
     * find their name, else use their name property. If name property an empty
     * string, use the relevant language depending on the group-by field
     * @memberof Group
     * @returns {string} Visual name of field
     */
    get_visual_name: function() {
      if(this.name) {
        if(window.userData) {
          return window.userData[this.name].name;
        }
        else {
          return this.name;
        }
      }
      else {
        switch(this.taskboard.groupBy) {
          case "owner":
          case "reporter":
          case "qualityassurancecontact":
            return "Unassigned";
          default:
            return "Unset";
        }
      }
    },

    /**
     * Position a ticket in order within a group, using the index
     * returned by _calculate_new_position()
     * @memberof Group
     * @param {Ticket} ticket
     */
    drop_in_place: function(ticket) {

      var $ticketsInContainer = $(".ticket", this.$elWrapper), pos;

      // No tickets in container
      if(!$ticketsInContainer.length) {
        ticket.$el.appendTo(this.$elWrapper);
      }
      else {
        pos = this._calculate_new_position(ticket);

        // If no position to insert, append to container
        if(pos == -1) {
          ticket.$el.appendTo(this.$elWrapper);
        }

        // Else, insert before the correct ticket
        else {
          $ticketsInContainer.eq(pos).before(ticket.$el);
        }
      }
    },

    /**
     * Calculate where a ticket should be placed within a group
     * @memberof Group
     * @private
     * @param {Ticket} ticket
     * @returns {Number} index to position the ticket in, or -1 to append
     */
    _calculate_new_position: function(ticket) {
      var pos = -1;

      $(".ticket", this.$elBody).not(ticket.$el).each(function(i) {
        if(ticket.greater_than($(this).data("_self"))) {
          pos = i;
          return false;
        }
      });
      return pos;
    },

    /**
     * Update the UI representation of the ticket count. This is colourized to
     * reflect how close this group's count is to the average
     * @memberof Group
     */
    update_ticket_count: function() {
      var average = this.taskboard.ticketCount / this.taskboard.groupCount,
          outlier_amount = Math.abs(average - this.ticketCount) / average,
          outlier_case = "", count;

      if (this.ticketCount == 0) outlier_case = "success";
      else if(outlier_amount >= 1) outlier_case = "warning";
      else if(outlier_amount >= 2/3) outlier_case = "error";
      else if(outlier_amount >= 1/3) outlier_case = "primary";
      else outlier_case = "success";

      if(this.maxCount) {
        count = this.ticketCount + "/" + this.maxCount;
      }
      else {
        count = this.ticketCount;
      }

      $(".group-count", this.$elHead)
	.attr("class", this.countClasses)
	.addClass("case-" + outlier_case);
      $(".group-count", this.$elHead).find("span.tickets")
        .text(count);
      $(".group-count", this.$elHead).find("span.hours")
        .text(this.ticketHours.toFixed(1));
      $(".group-count", this.$elHead).find("span.effort")
        .text(this.ticketEffort.toFixed(0));
    },

    /**
     * @memberof Group
     * Remove this group's DOM and references
     */
    remove: function() {
      this.$elHead.add(this.$elBody).remove();
      delete this.taskboard.groups[this.name];
      delete this.taskboard.groupsOrdered[this.order];
    }
  });


  // @namespace
  // TICKET PRIVATE CLASS DEFINITION (INSTANTIATED BY GROUP)
  // =======================================================
  var Ticket = Class.extend({

    /**
     * Initialise a new ticket
     * @constructor
     * @alias Ticket
     * @param {Group} group - The group to which this new ticket belong
     * @param {Number} id - The ticket's ID
     * @param {Object} tData - The ticket's data
     */
    init: function(group, id, tData) {
      this.group = group;
      this.id = parseInt(id, 10);
      this.tData = tData;

      this.draw();
      this.set_events();

      this.group.ticketCount ++;
      this.group.ticketHours += tData['remaininghours'];
      this.group.ticketEffort += tData['effort'];
      this.group.taskboard.ticketCount ++;
    },

    /**
     * Draw the ticket's elements, and add to the right position within the group
     * @memberof Ticket
     */
    draw: function() {
      var statsLength = this.statFields.length, i;

      this.$el = $("<div class='ticket' id='ticket-" + this.id + "'></div>");
      this.$elWait =  $("<div class='wait'><div class='indicators'></div></div>").appendTo(this.$el);
      this.$el.data("_self", this);
      this.$el.append("<a href='" + window.tracBaseUrl + "ticket/" + this.id + "' " +
                      "class='title unselectable tooltipped-above'>#" + this.id + ": <span></span></a>");

      for(i = 0; i < statsLength; i ++) {
        // we already show the summary in the ticket node header
        if ($.inArray(this.statFields[i], ["summary"]) < 0) {
          this.$el.append("<div class='stat stat-" + this.statFields[i] + 
                          " unselectable tooltipped' title='" + this.statFields[i] +"'>" +
                          "<i class='fa x-fa-" + this.statFields[i] + "'></i> <span></span>" +
                          "</div>");
        }
      }

      this.update_el();
      this.group.drop_in_place(this);
    },

    statFields: window.display_fields,

    /**
     * Update the ticket's UI values
     * @memberof Ticket
     */
    update_el: function() {
      var statsLength = this.statFields.length, i, stat;

      this.$el.attr("data-priority", this.tData.priority_value);
      $(".title span", this.$el).text(this.tData.summary);
      $(".title", this.$el).attr("data-original-title", this.tData.summary);

      for(i = 0; i < statsLength; i ++) {
        stat = this.statFields[i];
        $(".stat-" + stat + " span", this.$el).text(this.tData[stat]);
      }
    },

    /**
     * Set the draggable events for the ticket
     * @memberof Ticket
     */
    set_events: function() {
      var _this = this;

      $(".wait", this.$el).on("click", ".fa fa-exclamation-sign", function() {
        var $list = $("ul", _this.group.taskboard.$failDialog).html("");

        $.each(_this.errorInfo, function(i, msg) {
          $list.append("<li>" + msg + "</li>");
        });

        _this.group.taskboard.$failDialog.data("ticket", _this).dialog("open");
      });

      this.$el.draggable({
        opacity:0.7,
        helper: function(e) {
          var original = $(e.target).hasClass("ui-draggable") ? $(e.target) : $(e.target).closest(".ui-draggable");
          return original.clone().css({
            width: original.width()
          });
        },
        revert: "invalid",
        start: function () {
          _this.group.taskboard.set_valid_moves($(this).data("_self"));
        },
        stop: function () {
          _this.group.taskboard.reset_droppables();
        }
      });
    },

    /**
     * Given a new group and / or data, update this ticket. If the update was not
     * triggered by user interaction and the ticket has changed group, then animate
     * the move.
     * @memberof Ticket
     * @param {Object} data - the new data for the ticket
     * @param {Boolean} byUser - whether update was triggered by user interaction
     * @param {Group} [newGroup] - the new group to which this ticket belongs
     */
    update: function(data, byUser, newGroup) {
      var previous_tData = this.tData;
      this.tData = data;
      this.update_el();

      if(newGroup != this.group) {
        this.group.ticketCount --;
	this.group.ticketEffort -= previous_tData['effort'];
	this.group.ticketHours  -= previous_tData['remaininghours'];	
        this.group = newGroup;
        this.group.ticketCount ++;
	this.group.ticketEffort += this.tData['effort'];
	this.group.ticketHours  += this.tData['remaininghours'];	

        if(byUser) {
          this.save_ok_feedback();
        }
        else {
          this.animate_move(true);
        }
      }
      else {
	this.group.ticketEffort -= previous_tData['effort'];
	this.group.ticketHours  -= previous_tData['remaininghours'];	
	this.group.ticketEffort += this.tData['effort'];
	this.group.ticketHours  += this.tData['remaininghours'];	
        this.animate_move(false);
      }
    },

    /**
     * Check whether this ticket has no explicit position
     * @private
     * @memberof Ticket
     * @returns {Boolean}
     */
    _position_unset: function() {
      return this.tData.position === null;
    },

    /**
     * Given another ticket, calculate whether this ticket should be positioned
     * above or below the other
     * @memberof Ticket
     * @param {Ticket} - other
     * @returns {Boolean} True = above, False = below
     */
    greater_than: function(other) {
      var i, thisFactor, otherFactor,
        factors = [
          [this._position_unset(), other._position_unset()],
          [this.tData.position, other.tData.position],
          [this.tData.priority_value, other.tData.priority_value],
          [this.id, other.id]
        ];

      for(i = 0; i < factors.length; i ++) {
        thisFactor = factors[i][0];
        otherFactor = factors[i][1];

        if(thisFactor != otherFactor) {
          return thisFactor < otherFactor;
        }
      }
    },

    /**
     * Animate a ticket update, either into a new group, or into a new position
     * within a group. If the ticket group and position is unchanged then just
     * show a refresh icon.
     * @memberof Ticket
     * @param {Boolean} intoGroup - Whether the ticket has changed groups
     */
    animate_move: function(intoGroup) {
      var _this = this,
          needCopy, currentPos, newPos, parentOffset, newOffset, oldOffset;

      // We might also need to move the position within the group
      if(!intoGroup) {
        currentPos = $(".ticket", this.group.$elBody).index(this.$el);
        newPos = this.group._calculate_new_position(this);

        needCopy = currentPos != newPos;
      }

      if(intoGroup || needCopy) {

        // Calculate the current offset position, move the element, and recalculate
        parentOffset = this.$el.offsetParent().offset();
        oldOffset = this.$el.offset();

        // We store the original and move the copy into .$el as 'waiting' user 
        // feedback is set against .$el
        this.$elOriginal = this.$el;

        this.group.drop_in_place(this);
        newOffset = this.$el.offset();

        // Rewrite .$el with a clone
        this.$el = this.$el.clone().addClass("tmp").appendTo("#content");

        // Slide the original down, but make it appear as a placeholder
        this.$elOriginal.draggable("disable")
          .addClass("placeholder")
          .slideDown();

        // Set feedback against clone
        this.external_update_feedback(false);

        // Animate clone from original old's position to new
        this.$el.css("position", "absolute")
          .css("left", oldOffset.left - parentOffset.left)
          .css("top", oldOffset.top - parentOffset.top)
          .css("zIndex", 90)
          .css("width", this.$elOriginal.width())
          .animate({
              top: newOffset.top - parentOffset.top,
              left: newOffset.left - parentOffset.left
            },
            {
              duration: 800,
              complete: function() {
                $.wait(1000).then($.proxy(_this, "_animate_move_complete"));
              }
            });
      }
      else {
        this.external_update_feedback(true);
      }
    },

    /**
     * Once the move animation is complete, remove the clone and reinstate original
     * @private
     * @memberof Ticket
     */
    _animate_move_complete: function() {
      this.$el.remove();
      this.$el = this.$elOriginal.draggable("enable").removeClass("placeholder");

      // Nasty hack to force repainting on Win Chrome
      // without it, the UI is left with "streak marks" from the move
      // TODO remove when no longer needed
      if(isChrome && isWindows) {
        this.group.$elBody.fadeOut(1).fadeIn(1);
      }
    },

    /**
     * Hide the waiting cover
     * @memberof Ticket
     * @param {Number} [fade=0] - The time (ms) the cover takes to fade out 
     * @param {Number} [delay=0] - The delay (ms) before hiding
     * @param {Boolean} [enable_after] - Whether to enable dragging on the element afterwards (false when a clone of the original)
     */
    hide_wait: function(fade, delay, enable_after) {
      var _this = this;

      $(".wait", this.$el).delay(delay || 0).fadeOut(fade || 0, function() {
        if(enable_after) _this.$el.draggable("enable");
      });
    },

    /**
     * Show the waiting cover
     * @memberof Ticket
     * @param {string} icon - The class(es) of the icon to show
     * @param {Number} [fade=50] - The time (ms) the cover takes to fade in
     * @param {Boolean} [disable=false] - Whether prevent the ticket from being dragged
     */
    show_wait: function(icon, fade, disable) {
      var $wait = $(".wait", this.$el).clearQueue().fadeIn(fade || 50);

      $(".indicators", $wait)
        .clearQueue()
        .removeAttr("class")
        .addClass("indicators " + icon);

      if(disable) this.$el.draggable("disable");
    },

    /**
     * Set the waiting icon for the ticket cover
     * @memberof Ticket
     * @param {string} icon - The class(es) of the icon to show
     * @param {Number} fade - The time it takes to both fade out the old icon and fade in the new one
     */
    set_wait_icon: function(icon, fade) {
      var $current_icon = $(".indicators", this.$el),
          $new_icon = $("<div></div>").addClass("indicators " + icon);

      $.when($current_icon.fadeOut(fade))
        .then(function() {
          $current_icon.after($new_icon).remove();
          $new_icon.hide().fadeIn(fade);
        });
    },

    /**
     * Display a waiting icon and disable the ticket from being dragged
     * @memberof Ticket
     */
    freeze: function(fade) {
      this.show_wait("fa fa-spinner fa-spin", fade, true);
    },

    /**
     * Display then hide an OK icon after a successful save
     * @memberof Ticket
     */
    save_ok_feedback: function() {
      this.set_wait_icon("fa fa-check-circle color-success-light", 400);
      this.hide_wait(400, 1400, true);
    },

    /**
     * Display (and don't hide) a failed icon, store the reason why
     * @param {Array} why - a list of reasons why this ticket failed to save
     * @memberof Ticket
     */
    save_failed_feedback: function(why) {
      this.set_wait_icon("fa fa-exclamation-sign color-warning-light", 400);
      this.errorInfo = why;
    },

    /**
     * Display then hide a spinner icon after a ticket has been updated remotely
     * @param {Boolean} is_original - Element is original or clone (don't later enable dragging for clone)
     * @memberof Ticket
     */
    external_update_feedback: function(is_original) {
      this.show_wait("fa fa-refresh fa-spin color-info-light", 400, is_original);
      this.hide_wait(400, 1400, is_original);
    },

    /**
     * Remove this ticket's DOM and references
     * @memberof Ticket
     */
    remove: function() {
      this.$el.slideUp(function() {
        $(this).remove();
      });

      this.group.ticketCount --;
      this.group.ticketEffort -= this.group.taskboard.tickets[this.id]['effort'];
      this.group.ticketHours  -= this.group.taskboard.tickets[this.id]['remaininghours'];	
      delete this.group.taskboard.tickets[this.id];
      this.group.taskboard.update_ticket_counts();
    }
  });

  /**
   * Change query, this will be removed later when replaced with actual query system
   */
  function event_change_query() {
    var allOptions = {
          allowClear: false,
          width: "off",
          containerCssClass: "block-phone"
        },
        milestones = $.extend({ "data": window.milestones }, allOptions);

    $("#taskboard-query select").select2(allOptions);
    $("#tb-milestones-select").select2(milestones);
    $("#taskboard-query select, #tb-milestones-select").on("change", function() {
      $(this).parent().submit();
    });
    $("#btn-update-taskboard").on("click", function() {
      $("#taskboard-query").submit();
    });
  }


  /**
   * Toggle the visibility of the ticket field check button container.
   */
  function event_toggle_stat_fields() {

    $("#mods-columns").toggle();

    // it would be better to use a class which adds margin-top and then 
    // toggle that class, but as the value for this property is 
    // computed at run-time I've opted for this approach
    if ($("#mods-columns").is(":visible")) {
      $("#taskboard").css("margin-top", 
        ($("#mods-columns").outerHeight() + 20).toString() + "px");
    } else {
      $("#taskboard").css("margin-top", "10px");
    }

  }

  /**
   * Toggle between condensed and expanded view
   */
  function event_toggle_condensed() {
    /*jshint validthis: true */
    $("i", this).toggleClass("fa-th-large fa-th");
    $("#content").toggleClass("view-condensed");
  }

  /**
   * Toggle fullscreen mode
   */
  function event_toggle_fullscreen() {
    /*jshint validthis: true */
    $("i", this).toggleClass("fa-arrows-alt fa-compress");
    $("body").toggleClass("fullscreen");
  }

  /**
   * Initialise filters
   * @param {Taskboard} taskboard - The taskboard to communicate with
   */
  function init_filters(taskboard) {
    var $filterSelect = $("#set-groups-select"),
        groupsCount = taskboard.groupsOrdered.length, i, group;

    for(i = 0; i < groupsCount; i ++) {
      group = taskboard.groupsOrdered[i];
      $filterSelect.append("<option value='" + group.name + "'" +
                          (group.visible ? " selected='selected'" : "") +
                          ">" + group.get_visual_name() + "</option>");
    }

    $filterSelect.select2({
      maximumSelectionSize:20
    });

    $filterSelect.on("change", function(e) {
      if(e.added)   taskboard.filter_add(e.added.id);
      if(e.removed) taskboard.filter_remove(e.removed.id);
    });

    $("#set-groups-clear").on("click", function() {
      $filterSelect.select2("val", "");
      taskboard.filter_groups([]);
    });
  }

  /**
   * Initialise popovers
   */
  function init_popovers() {
    $("#btn-groups-filter").popoverWith("#popover-groups", {
      title: "Filter groups"
    });

    // Prevent the select2 from closing the popover
    var popoverCtrl = $("#btn-groups-filter").data("popoverWith");
    $("#set-groups-select").on("select2-focus", function() {
        popoverCtrl.ignoreClicks = true;
      })
      .on("select2-blur", function() {
        popoverCtrl.ignoreClicks = false;
      });

    $("#btn-change-workflow").popoverWith("#popover-workflows", {
      title: "Change workflow"
    });
  }

  /**
   * When automatically filtered on page load, display a notice
   */
  function show_filter_msg($container) {
    var $filterMsg = $("<div id='filtered-note' class='box-info large take-color'>" +
                         "<i class='fa fa-info-circle'></i> " +
                         "The taskboard has been automatically filtered to show " +
                         "only the group with the most results. Click the " +
                         "<span class='filtered-option pointer'>filtered groups " +
                         "option</span> to configure." +
                         "<button type='button' class='close btn btn-mini'>" +
                         "<i class='fa fa-times'></i>" +
                         "</button>" +
                       "</div>");

    $container.before($filterMsg);

    $("#filtered-note .close").one("click", function() {
      $filterMsg.slideUp(function() {
        $filterMsg.remove();
      });
    });

    $(document).on("click", ".filtered-option", function() {
      $filterMsg.slideUp(function() {
        $filterMsg.remove();
      });
      $("#btn-groups-filter").trigger("click");
    });

  }

  /**
   * Generate the select2 to control switching workflows
   */
  function show_workflow_controls(workflows) {
    var $select = $("#popover-workflows select"), selected, i;

    $("#btn-change-workflow").addClass("show");
    $("#workflow-count").text(workflows.length);

    for(i = 0; i < workflows.length; i ++) {
      selected = workflows[i] == taskboard.workflow ? " selected='selected'" : "";
      $select.append("<option" + selected + " >" + workflows[i] + "</option>");
    }

    $select.select2({ width: "off" })
      .on("change", function() {
        taskboard.change_workflow($(this).val());
      });
  }

  /**
   * When a milestone has no tickets, notify the user
   */
  function show_no_ticket_msg($container) {
    var $msg = $("<div class='box-info large take-color'>" +
                   "<h1><i class='fa fa-info-circle'></i> No Tickets Found</h1>" +
                 "</div");

    $container.before($msg);
  }

}(window.jQuery, window.Class));
