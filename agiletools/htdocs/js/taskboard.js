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

var taskboard,
    isChrome = "chrome" in window,
    isWindows = navigator.userAgent.toLowerCase().indexOf("windows") != -1;

// DOCUMENT READY CALL
// ===================
$(document).ready(function() {
  var $container = $("#taskboard-container");

  // Only instantiate the taskboard if we have ticket data
  if(window.tickets) {
    taskboard = new Taskboard("taskboard", $container, window.groupName,
                              window.groups, window.tickets, window.currentWorkflow);

    init_popovers($container);
    init_filters(taskboard);
    if(taskboard.filtered) show_filter_msg($container);

    if(window.groupName == "status") {
      workflows = taskboard.get_workflows();
      if(workflows.length > 1) show_workflow_controls(workflows);
    }

    $("#taskboard-controls").addClass("visible");
    $("#btn-switch-view").on("click", event_toggle_condensed);
    $("#btn-fullscreen").on("click", event_toggle_fullscreen);
  }
  else {
    show_no_ticket_msg($container);
  }

  event_change_query();
});


// @namespace
// TASKBOARD PUBLIC CLASS DEFINITION
// =================================
var Taskboard = LiveUpdater.extend({

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

    var _this = this;
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
    this.groupData = groupData;
    this.ticketData = ticketData;
    this.workflow = workflow;

    // Once instantiated, we keep track of our groups and tickets via these objects
    this.groups = {};
    this.groupsOrdered = [];
    this.tickets = {};

    this.set_data_object(this.workflow);

    this.ticketCount = this.groupCount = 0;

    for(var i = 0; i < this.curGroupData.length; i ++) {
      var groupName = this.curGroupData[i],
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
        if(_this.$optDialog.data("done")) {
          _this.$optDialog.data("done", false);
        }
        else {
          var ticket = _this.$optDialog.data("ticket");
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
        ticket = $(this).data("ticket");
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
   * Collect workflow names from the ticket data
   * @memberof Taskboard
   */
  get_workflows: function() {
    if(this.groupBy == "status") {
      w = [];
      for(workflow in this.ticketData) w.push(workflow);
      return w;
    }
  },

  /**
   * Returns a nested-list of groups and their number of tickets
   * @memberof Taskboard
   * @returns {Array} [[<group>, <group-count>], ...]
   */
  order_groups_by_count: function() {
    var i = 0,
        byCount = [];

    for(var groupName in this.groups) {
      var group = this.groups[groupName],
          pos = -1;

      for(var j = 0; j < i; j ++) {
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
    return byCount;
  },

  /**
   * Filter the groups to only show a selection of them.
   * If no groups supplied, show the most popular 8
   * @memberof Taskboard 
   * @param {Array} [groups] - List of groups to show
   */
  filter_groups: function(groups) {
    var i, group, groupName,
        x = 8,
        aboveX = false;

    if(!groups) {
      if(this.groupCount > x) {
        var byCount = this.order_groups_by_count();
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
        for(groupName in this.groups) this.groups[groupName].filter_show();
        this.filtered = false;
      }
    }

    // If user specified filter, group instances need to be collected
    else {
      for(groupName in this.groups) {
        var visible = false;
        group = this.groups[groupName];
        var filterLength = groups.length;
        for(i = 0; i < filterLength; i ++) {
          if(group.name == groups[i]) {
            visible = true;
            break;
          }
        }
        if(visible) group.filter_show();
        else group.filter_hide();
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
    if(this.groupBy == "status") {
      var actions = ticket.tData.actions;

      for(var groupName in this.groups) {
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
      this._process_generic_move(ticket, newGroup, fromDialog);
    }
  },

  /**
   * Process a ticket move when grouping by all other than status
   * @private
   * @memberof Taskboard
   */
  _process_generic_move: function(ticket, newGroup, fromDialog) {
    var data = { 'value' : newGroup.name };
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
    if(ticket.tData.actions.hasOwnProperty(newGroup.name)) {
      var action = ticket.tData.actions[newGroup.name];
      var data = { 'action': action[0] };

      if(!fromDialog) {
        for(var i = 0; i < action[1].length; i ++) {
          var operation = action[1][i];
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
    ticket.freeze();

    var _this = this,
        url = window.tracBaseUrl + "taskboard",
        data = {
          '__FORM_TOKEN': window.formToken,
          'group_name': this.groupBy,
          'ticket': ticket.id,
          'ts': ticket.tData['changetime'],
        };
        $.extend(data, newData);

    // Add our dialog inputs to our post list
    if(fromDialog) {
      $("input, select", this.$optDialog).each(function() {
        data[$(this).attr("name")] = $(this).val();
      });
    }

    $.post(url, data, function(data, status, jqXHR) {
      if(data.error) {
        ticket.save_failed_feedback(data['error']);
      }
      else {
        _this.process_update(data, true);
      }
    }).fail(function(jqXHR) {
      var errors = [jqXHR.status + ": " + jqXHR.statusText],
          $feedback = $(jqXHR['responseText']).contents().find("#content.error");
          $errorCode = $(".message pre", $feedback);
      if($errorCode.length) {
        errors.push("Error code: " + $errorCode.html());
      }
      ticket.save_failed_feedback(errors);
    });
  },

  /**
   * Process an update from the server. UI response depends on whether
   * triggered by the user (i.e. after a save request). Deal with adding and
   * removing tickets which have changed their scope (i.e. a milestone change)
   * @memberof Taskboard
   * @param {Object} data - JSON object returned by the server
   *   @param {Object} data.ticket - Ticket information
   *   @param {Object} data.opts - Additional options
   *   @param {Array}  data.otherChanges - ticket IDs which have changed but are not in scope
   * @param {Boolean} byUser - Was action was triggered by user or general
   */
  process_update: function(data, byUser) {
    if(data.tickets) {
      newData = data.tickets;

      if(this.groupBy == "status") {

        // For every updated ticket, delete any existing data
        function delete_ticket_data(id) {
          for(var orig_wf in this.ticketData) {
            for(var orig_g in this.ticketData[orig_wf]) {
              if(this.ticketData[orig_wf][orig_g][t]) {
                delete this.ticketData[orig_wf][orig_g][t];
                return;
              }
            }
          }
        }

        for(var wf in newData) {
          for(var g in newData[wf]) {
            for(var t in newData[wf][g]) {
              // Remove any instantiated tickets which have moved to another workflow
              if(this.tickets[t] && wf != this.workflow) {
                this.tickets[t].remove();
              }
              delete_ticket_data.apply(this, [t]);
            }
          }
        }

        // Add new ticket data
        $.extend(true, this.ticketData, newData);

        // Only tickets in the current workflow are instantiated
        // so only perform the following actions on those
        newData = newData[this.workflow];
      }

      for(var g in newData) {
        for(var t in newData[g]) {
          var ticket = this.tickets[t],
              newTData = newData[g][t],
              newGroup = this.groups[g];

          if(newGroup) {
            if(ticket) {
              var oldGroup = ticket.group;

              // If this is a change we don't already know about
              if(ticket.tData.changetime != newTData.changetime) {
                // If the groups are different, update group counts too
                if(newGroup != oldGroup) {
                  if(newGroup) newGroup.ticket_added();
                  oldGroup.ticket_removed();
                  ticket.update(newTData, byUser, newGroup);
                }
                else {
                  ticket.update(newTData, byUser);
                }
              }
            }
            else {
              // Ticket moved into query's scope, instantiate
              this.tickets[t] = new Ticket(newGroup, t, newTData);
              this.ticketCount ++;
              newGroup.ticketCount ++;
            }
          }
          else {
            // We've never seen this group before, reload taskboard entirely
            this.refresh();
          }
        }
      }
      this.update_ticket_counts();
    }
    if(data.ops) {
      for(var op in data.ops) {
        window.operationOptions[op] = data["ops"][op];
      }
    }
    // If a ticket is changed outside of our current query's scope, then we need
    // To check if it's currently in our taskboard, and if it is, remove it.
    if(data.otherChanges) {
      for(var i = 0; i < data.otherChanges.length; i ++) {
        if(this.tickets[data.otherChanges[i]]) {
          this.tickets[data.otherChanges[i]].remove();
        }
      }
    }
  },

  /**
   * Loop through every group and ask them to recalculate their number of tickets
   * @memberof Taskboard
   */
  update_ticket_counts: function() {
    for(var groupName in this.groups) this.groups[groupName].update_ticket_count();
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
    this.$optDialog.data({
      "ticket": ticket,
      "group": newGroup
    });
    this.$optDialog.html(operation[2]);
    $("select", this.$optDialog).select2({
      width: "off",
      adaptContainerCssClass: function(cls) { return null; },
      dropdownCssClass: "ui-dialog"
    });
    this.$optDialog.dialog({ title: operation[1] })
                  .dialog("open");
  },

  /**
   * Re-enable all droppables (groups)
   * @memberof Taskboard
   */
  reset_droppables: function() {
    for(var group in this.groups) {
      this.groups[group].$elBody.droppable("enable").removeClass("over disabled");
    }
  },

  /**
   * Completely refresh the taskboard. Useful when minute differences are not picked up
   * @memberof Taskboard
   * @param {Boolean} notify - whether to make the update evident to the user
   */
  refresh: function(notify) {
    var _this = this;
    if(notify) {
      var $loadMsg = $("<div class='taskboard-refresh'>" +
                       "<i class='icon-refresh icon-spin color-info'></i>" +
                     "</div>").appendTo(this.$container);
    }
    $.ajax({
      success:function(data, textStatus, jqXHR) {
        _this.teardown();

        // Throw all of our data into the window object
        $.extend(window, data);

        _this.construct(data.groups, data.tickets, data.currentWorkflow);
        if(!silent) {
          setTimeout(function() {
            $loadMsg.fadeOut(function() {
              $loadMsg.remove();
            });
          }, 1000);
        }
      }
    });
  },

  /**
   * Construct a new taskboard given a workflow
   * @memberof Taskboard
   * @param {string} workflow - The name of the workflow to draw
   */
  change_workflow: function(workflow) {
    if(this.ticketData[workflow]) {
      var t = this.ticketData,
          g = this.groupData;

      this.teardown();
      this.construct(g, t, workflow);
    }
  },

  /**
   * Teardown the taskboard, removing all group and ticket models and DOM elements
   * @memberof Taskboard
   */
  teardown: function() {
    for(var ticket in this.tickets) {
      this.tickets[ticket].remove();
    }
    for(var groupName in this.groups) {
      this.groups[groupName].remove();
    }
    delete this.tickets;
    delete this.ticketData;
    delete this.groups;
    delete this.groupsOrdered;
    delete this.groupData;
    clearInterval(this.upInterval);
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
    this.ticketCount = 0;

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
    this.$elHead = $("<th class='cf'></th>");
    var avatar = (((window.userData||{})[this.name]||{})).avatar;
    if(avatar) {
      this.$elHead.append("<img class='hidden-phone group-avatar' src='" + avatar + "' a />");
    }
    this.$elHead.append("<div class='group-count hidden-phone'></div>");
    this.$elHead.append("<div class='group-name'>" + this.get_visual_name() + "</div>");
    $("thead tr", this.taskboard.$el).append(this.$elHead);
  },

  /**
   * Draw the body of the group. Loop over ticketData, instantiate new Ticket for each.
   * @private
   * @memberof Group
   */
  _draw_body: function() {
    this.$elBody = $("<td class='tickets'></td>");
    for(var ticketId in this.ticketData) {
      this.taskboard.tickets[ticketId] = new Ticket(this, ticketId, this.ticketData[ticketId]);
    }
    this.$elBody.data("_self", this);
    $("tbody tr", this.taskboard.$el).append(this.$elBody);
  },

  /**
   * Set the droppable events for this group
   * @memberof Group
   */
  set_events: function() {
    var _this = this;
    this.$elBody.droppable({
      accept:'div.ticket',
      over: function(e, ui) {
        $(this).addClass("over");
      },
      out: function(e, ui) {
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
    var $ticketsInContainer = $(".ticket", this.$elBody);

    // No tickets in container
    if(!$ticketsInContainer.length) {
      ticket.$el.appendTo(this.$elBody);
    }
    else {
      var pos = this._calculate_new_position(ticket);

      // If no position to insert, append to container
      if(pos == -1) {
        ticket.$el.appendTo(this.$elBody);
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
   * Increment the group's ticket count
   * @memberof Group
   */
  ticket_added: function() {
    this.ticketCount ++;
    this.update_ticket_count();
  },

  /**
   * Decrement the group's ticket count
   * @memberof Group
   */
  ticket_removed: function() {
    this.ticketCount --;
    this.update_ticket_count();
  },

  /**
   * Update the UI representation of the ticket count. This is colourized to
   * reflect how close this group's count is to the average
   * @memberof Group
   */
  update_ticket_count: function() {
    var average = this.taskboard.ticketCount / this.taskboard.groupCount,
        outlier_amount = Math.abs(average - this.ticketCount) / average,
        outlier_case = "";

    if(outlier_amount >= 1) outlier_case = "warning";
    else if(outlier_amount >= 2/3) outlier_case = "error";
    else if(outlier_amount >= 1/3) outlier_case = "primary";
    else outlier_case = "success";

    if(this.maxCount) {
      count = this.ticketCount + "/" + this.maxCount;
    }
    else {
      count = this.ticketCount;
    }

    $(".group-count", this.$elHead).addClass("case-" + outlier_case).text(count);
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
    this.group.taskboard.ticketCount ++;
  },

  /**
   * Draw the ticket's elements, and add to the right position within the group
   * @memberof Ticket
   */
  draw: function() {
    this.$el = $("<div class='ticket' id='ticket-" + this.id + "'></div>");
    this.$elWait =  $("<div class='wait'><div class='indicators'></div></div>").appendTo(this.$el);
    this.$el.data("_self", this);
    this.$el.append("<a href='" + window.tracBaseUrl + "ticket/" + this.id + "' " +
                    "class='title unselectable tooltipped-above'>#" + this.id + ": <span></span></a>");
    var statsLength = this.statFields.length;
    for(var i = 0; i < statsLength; i ++) {
      this.$el.append("<div class='stat stat-" + this.statFields[i] + " unselectable'>" +
                       "<i class='icon-" + this.statFields[i] + "'></i> <span></span>" +
                     "</div>");
    }
    this.update_el();
    this.group.drop_in_place(this);
  },

  statFields: ["type", "owner", "priority", "milestone"],

  /**
   * Update the ticket's UI values
   * @memberof Ticket
   */
  update_el: function() {
    var _this = this;
    this.$el.attr("data-priority", this.tData["priority_value"]);
    $(".title span", this.$el).text(_this.tData['summary']);
    $(".title", this.$el).attr("data-original-title",_this.tData['summary']);

    var statsLength = this.statFields.length;
    for(var i = 0; i < statsLength; i ++) {
      var stat = this.statFields[i];
      $(".stat-" + stat + " span", this.$el).text(_this.tData[stat]);
    }
  },

  /**
   * Set the draggable events for the ticket
   * @memberof Ticket
   */
  set_events: function() {
    var _this = this;

    $(".wait", this.$el).on("click", ".icon-exclamation-sign", function() {
      $list = $("ul", _this.group.taskboard.$failDialog).html("");
      $.each(_this.errorInfo, function(i, msg) {
        $list.append("<li>" + msg + "</li>");
      });
      _this.group.taskboard.$failDialog.data("ticket", _this).dialog("open");
    });

    this.$el.draggable({
      opacity:0.7,
      helper: function(e) {
        original = $(e.target).hasClass("ui-draggable") ? $(e.target) : $(e.target).closest(".ui-draggable");
        return original.clone().css({
          width: original.width()
        });
      },
      revert: "invalid",
      start: function (e, ui) {
        _this.group.taskboard.set_valid_moves($(this).data("_self"));
      },
      stop: function (e, ui) {
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
    this.tData = data;
    this.update_el();
    if(newGroup) {
      this.group = newGroup;
      if(byUser) {
        this.save_ok_feedback();
      }
      else {
        this.animate_move(true);
      }
    }
    else {
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
    return this.tData.position == null;
  },

  /**
   * Given another ticket, calculate whether this ticket should be positioned
   * above or below the other
   * @memberof Ticket
   * @param {Ticket} - other
   * @returns {Boolean} True = above, False = below
   */
  greater_than: function(other) {

    var factors = [
      [this._position_unset(), other._position_unset()],
      [this.tData.position, other.tData.position],
      [this.tData.priority_value, other.tData.priority_value],
      [this.id, other.id]
    ];

    for(var i = 0; i < factors.length; i ++) {
      var thisFactor = factors[i][0],
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
    var _this = this;

    // We might also need to move the position within the group
    if(!intoGroup) {
      var $ticketsInGroup = $(".ticket", this.group.$elBody),
          currentPos = $ticketsInGroup.index(this.$el),
          newPos = this.group._calculate_new_position(this);
          needCopy = currentPos != newPos;
    }
    if(intoGroup || needCopy) {

      // Calculate the current offset position, move the element, and recalculate
      var parentOffset = this.$el.offsetParent().offset(),
          oldOffset = this.$el.offset(),
          newOffset;

      // We store the original and move the copy into .$el as 'waiting' user 
      // feedback is set against .$el
      this.$elOriginal = this.$el;

      this.group.drop_in_place(this);
      newOffset = this.$el.offset();

      // Rewrite .$el with a clone
      this.$el = this.$el.clone().addClass("tmp").appendTo('#content');
      // Slide the original down, but make it appear as a placeholder
      this.$elOriginal.draggable("disable")
                     .addClass("placeholder")
                     .slideDown();

      // Set feedback against clone
      this.external_update_feedback(false);

      // Animate clone from original old's position to new
      this.$el.css('position', 'absolute')
              .css('left', oldOffset.left - parentOffset.left)
              .css('top', oldOffset.top - parentOffset.top)
              .css('zIndex', 90)
              .css('width', this.$elOriginal.width())
              .animate({
                'top': newOffset.top - parentOffset.top,
                'left': newOffset.left - parentOffset.left
              },
              {
                duration: 800,
                complete: function() {

                  // Once we're finished, remove the clone, and reinstate original
                  setTimeout(function() {
                    _this.$el.remove();
                    _this.$el = _this.$elOriginal.draggable("enable")
                                                 .removeClass("placeholder");

                    // Nasty hack to force repainting on Win Chrome
                    // without it, the UI is left with "streak marks" from the move
                    // TODO remove when no longer needed
                    if(isChrome && isWindows) {
                      _this.group.$elBody.fadeOut(1, function() {
                        _this.group.$elBody.fadeIn(1);
                      });
                    }
                  }, 1000);
                }
              });
    }
    else {
      this.external_update_feedback(true);
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
    var $wait = $(".wait", this.$el).clearQueue();
    $(".indicators", $wait)
      .clearQueue()
      .removeAttr("class")
      .addClass("indicators " + icon);
    $wait.fadeIn(fade || 50);
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

    $current_icon.fadeOut(fade, function() {
      $current_icon.after($new_icon).remove();
      $new_icon.hide().fadeIn(fade);
    });
  },

  /**
   * Display a waiting icon and disable the ticket from being dragged
   * @memberof Ticket
   */
  freeze: function(fade) {
    this.show_wait("icon-spinner icon-spin", fade, true);
  },

  /**
   * Display then hide an OK icon after a successful save
   * @memberof Ticket
   */
  save_ok_feedback: function() {
    this.set_wait_icon("icon-ok-sign color-success-light", 400);
    this.hide_wait(400, 1400, true);
  },

  /**
   * Display (and don't hide) a failed icon, store the reason why
   * @param {Array} why - a list of reasons why this ticket failed to save
   * @memberof Ticket
   */
  save_failed_feedback: function(why) {
    this.set_wait_icon("icon-exclamation-sign color-warning-light", 400);
    this.errorInfo = why;
  },

  /**
   * Display then hide a spinner icon after a ticket has been updated remotely
   * @param {Boolean} is_original - Element is original or clone (don't later enable dragging for clone)
   * @memberof Ticket
   */
  external_update_feedback: function(is_original) {
    this.show_wait("icon-refresh icon-spin color-info-light", 400, is_original);
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
    delete this.group.taskboard.tickets[this.id];
    this.group.taskboard.ticketCount --;
    this.group.ticketCount --;
    this.group.taskboard.update_ticket_counts();
  }
});

/**
 * Change query, this will be removed later when replaced with actual query system
 */
function event_change_query() {
  all_options = {
    allowClear: false,
    width: "off",
    containerCssClass: "block-phone",
  };
  milestones = $.extend({ 'data': window.milestones }, all_options);

  $("#taskboard-query select").select2(all_options);
  $("#tb-milestones-select").select2(milestones);
  $("#taskboard-query select, #tb-milestones-select").on("change", function() {
    $(this).parent().submit();
  });
}

/**
 * Toggle between condensed and expanded view
 */
function event_toggle_condensed() {
  $("i", this).toggleClass("icon-th-large icon-th");
  $("#content").toggleClass("view-condensed");
}

/**
 * Toggle fullscreen mode
 */
function event_toggle_fullscreen() {
  $("i", this).toggleClass("icon-fullscreen icon-resize-small");
  $("body").toggleClass("fullscreen");
}

/**
 * Initialise filters
 * @param {Taskboard} taskboard - The taskboard to communicate with
 */
function init_filters(taskboard) {
  var $filterSelect = $("#set-groups-select");
  var groupsCount = taskboard.groupsOrdered.length;
  for(var i = 0; i < groupsCount; i ++) {
    var group = taskboard.groupsOrdered[i];
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
function init_popovers($container) {
  $("#btn-groups-filter").popoverWith("#popover-groups", {
    title: "Filter groups"
  });
  $("#btn-change-workflow").popoverWith("#popover-workflows", {
    title: "Change workflow"
  });
}

/**
 * When automatically filtered on page load, display a notice
 */
function show_filter_msg($container) {
  var $filterMsg = $('<div id="filtered-note" class="box-info large take-color pointer">' +
                       '<i class="icon-info-sign"></i> ' +
                       'The taskboard has been automatically filtered to show ' +
                       'only the group with the most results. Click to configure.' +
                     '</div>');
  $container.before($filterMsg);

  $(document).one("click", function() {
    $filterMsg.slideUp(function() {
      $filterMsg.remove();
    });
    $("#btn-groups-filter").click();
  });
}

/**
 * Generate the select2 to control switching workflows
 */
function show_workflow_controls(workflows) {
  $("#btn-change-workflow").addClass("show");
  $("#workflow-count").text(workflows.length);
  var $select = $("#popover-workflows select");
  for(var i = 0; i < workflows.length; i ++) {
    selected = workflows[i] == taskboard.workflow ? " selected='selected'" : "";
    $select.append("<option" + selected + " >" + workflows[i] + "</option>");
  }
  $select.select2({ width: "off" });
  $select.on("change", function() {
    taskboard.change_workflow($(this).val());
  });
}

/**
 * When a milestone has no tickets, notify the user
 */
function show_no_ticket_msg($container) {
  var $msg = $("<div class='box-info large take-color'>" +
                 "<h1><i class='icon-info-sign'></i> No Tickets Found</h1>" +
               "</div");
  $container.before($msg);
}