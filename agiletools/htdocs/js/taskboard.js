var isChrome = "chrome" in window,
    isWindows = navigator.userAgent.toLowerCase().indexOf("windows") != -1;

// DOCUMENT READY CALL
// ===================
$(document).ready(function() {
  var $container = $("#taskboard-container");

  // Only instantiate the taskboard if we have ticket data
  if(window.tickets) {
    var taskboard = new Taskboard("taskboard", $container, window.groupName,
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


// TASKBOARD PUBLIC CLASS DEFINITION
// =================================
var Taskboard = LiveUpdater.extend({

  init: function(id, $container, groupBy, groupData, ticketData, defaultWorkflow) {

    var _this = this;
    this.id = id;
    this.groupBy = groupBy;

    this.$container = $container;
    this.draw_table();
    this.draw_dialogs();

    this.construct(groupData, ticketData, defaultWorkflow);
  },

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

  draw_table: function() {
    this.$el = $("<table id='"+this.id+"'>" +
                  "<thead><tr></tr></thead>" +
                  "<tbody><tr></tr></tbody>" +
                "</table>");
    this.$container.append(this.$el);
  },

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

  // When we're viewing tickets by status, we can't show multiple
  // Workflows at once, so the structure of tickets/groups is different
  // This interface returns the same structure for all groups
  set_data_object: function(workflow) {
    if(workflow) {
      // Reques to change to different workflow
      this.curTicketData = this.ticketData[workflow];
      this.curGroupData = this.groupData[workflow];
    }
    else {
      this.curTicketData = this.ticketData;
      this.curGroupData = this.groupData;
    }
  },

  get_workflows: function() {
    if(this.groupBy == "status") {
      w = [];
      for(workflow in this.ticketData) w.push(workflow);
      return w;
    }
  },

  // Returns [[<group-object>, <group-count>], ...]
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
      else {
        // If no group set, and no need to filter, show all
        for(groupName in this.groups) this.groups[groupName].filter_show();
        this.filtered = false;
      }
    }
    else {
      // If user specified filter, group instances need to be collected
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

  filter_add: function(groupName) {
    this.groups[groupName].filter_show();
  },

  filter_remove: function(groupName) {
    this.groups[groupName].filter_hide();
  },

  // Restrict the user from moving the current ticket to certain groups
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

  // Process a move request
  process_move: function(ticket, newGroup, fromDialog) {
    if(this.groupBy == "status") {
      this._process_status_move(ticket, newGroup, fromDialog);
    }
    else {
      this._process_generic_move(ticket, newGroup, fromDialog);
    }
  },

  _process_generic_move: function(ticket, newGroup, fromDialog) {
    var data = { 'value' : newGroup.name };
    this.save_ticket_change(ticket, data, false);
  },

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
        this.save_ticket_change(ticket, data, false);
      }
      else {
        this.save_ticket_change(ticket, data, true);
      }
    }
  },

  // Move request granted, save ticket via Ajax
  save_ticket_change: function(ticket, newData, fromDialog) {
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
            this.refresh(true);
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

  update_ticket_counts: function() {
    for(var groupName in this.groups) this.groups[groupName].update_ticket_count();
  },

  set_options: function(ticket, newGroup, operation) {
    this.$optDialog.data({
      "ticket": ticket,
      "group": newGroup
    });
    this.$optDialog.html(operation[2]);
    $("select", this.$optDialog).select2({
      adaptContainerCssClass: function(cls) { return null; },
      dropdownCssClass: "ui-dialog"
    });
    this.$optDialog.dialog({ title: operation[1] })
                  .dialog("open");
  },

  reset_droppables: function() {
    for(var group in this.groups) {
      this.groups[group].$elBody.droppable("enable").removeClass("over disabled");
    }
  },

  refresh: function(silent) {
    var _this = this;
    if(!silent) {
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

  change_workflow: function(workflow) {
    if(this.ticketData[workflow]) {
      var t = this.ticketData,
          g = this.groupData;

      this.teardown();
      this.construct(g, t, workflow);
    }
  },

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


// GROUP PRIVATE CLASS DEFINITION (INSTANTIATED BY TASKBOARD)
// ==========================================================
var Group = Class.extend({

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

  draw_elems: function() {
    this._draw_head();
    this._draw_body();
  },

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

  _draw_body: function() {
    this.$elBody = $("<td class='tickets'></td>");
    for(var ticketId in this.ticketData) {
      this.taskboard.tickets[ticketId] = new Ticket(this, ticketId, this.ticketData[ticketId]);
    }
    this.$elBody.data("_self", this);
    $("tbody tr", this.taskboard.$el).append(this.$elBody);
  },

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

  filter_show: function() {
    this.visible = true;
    this.$elHead.add(this.$elBody).removeClass("hidden");
  },

  filter_hide: function() {
    this.visible = false;
    this.$elHead.add(this.$elBody).addClass("hidden");
  },

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

  ticket_added: function() {
    this.ticketCount ++;
    this.update_ticket_count();
  },

  ticket_removed: function() {
    this.ticketCount --;
    this.update_ticket_count();
  },

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

  remove: function() {
    this.$elHead.add(this.$elBody).remove();
    delete this.taskboard.groups[this.name];
    delete this.taskboard.groupsOrdered[this.order];
  }
});


// TICKET PRIVATE CLASS DEFINITION (INSTANTIATED BY GROUP)
// =======================================================
var Ticket = Class.extend({
  init: function(group, id, tData) {
    this.group = group;
    this.id = parseInt(id, 10);
    this.tData = tData;

    this.draw();
    this.set_events();

    this.group.ticketCount ++;
    this.group.taskboard.ticketCount ++;
  },

  draw: function() {
    this.$el = $("<div class='ticket' id='ticket-" + this.id + "'></div>");
    this.$elWait =  $("<div class='wait'><div class='indicators'></div></div>").appendTo(this.$el);
    this.$el.data("_self", this);
    this.$el.append("<a href='" + window.tracBaseUrl + "ticket/" + this.id + "' " +
                    "class='title unselectable'>#" + this.id + ": <span></span></a>");
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

  update_el: function() {
    var _this = this;
    this.$el.attr("data-priority", this.tData["priority_value"]);
    $(".title span", this.$el).text(_this.tData['summary']);

    var statsLength = this.statFields.length;
    for(var i = 0; i < statsLength; i ++) {
      var stat = this.statFields[i];
      $(".stat-" + stat + " span", this.$el).text(_this.tData[stat]);
    }
  },

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

  _position_unset: function() {
    return this.tData.position == null;
  },

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
      // We store the original and move the copy into .$el as 'waiting' user 
      // feedback is set against .$el
      this.$elOriginal = this.$el;
      // Calculate the current offset position, move the element, and recalculate
      var oldOffset = this.$el.offset();
      this.group.drop_in_place(this);
      var newOffset = this.$el.offset();
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
              .css('left', oldOffset.left)
              .css('top', oldOffset.top)
              .css('zIndex', 90)
              .css('width', this.$elOriginal.width())
              .animate({
                'top': newOffset.top,
                'left': newOffset.left
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

  hide_wait: function(fade, delay, enable_after) {
    var _this = this;
    $(".wait", this.$el).delay(delay || 0).fadeOut(fade || 0, function() {
      if(enable_after) _this.$el.draggable("enable");
    });
  },

  show_wait: function(icon, fade, disable) {
    var $wait = $(".wait", this.$el).clearQueue();
    $(".indicators", $wait)
      .clearQueue()
      .removeAttr("class")
      .addClass("indicators " + icon);
    $wait.fadeIn(fade || 50);
    if(disable) this.$el.draggable("disable");
  },

  set_wait_icon: function(icon, fade) {
    var $current_icon = $(".indicators", this.$el),
        $new_icon = $("<div></div>").addClass("indicators " + icon);

    $current_icon.fadeOut(fade, function() {
      $current_icon.after($new_icon).remove();
      $new_icon.hide().fadeIn(fade);
    });
  },

  freeze: function(fade) {
    this.show_wait("icon-spinner icon-spin", fade, true);
  },

  save_ok_feedback: function() {
    this.set_wait_icon("icon-ok-sign color-success-light", 400);
    this.hide_wait(400, 1400, true);
  },

  save_failed_feedback: function(why) {
    this.set_wait_icon("icon-exclamation-sign color-warning-light", 400);
    this.errorInfo = why;
  },

  external_update_feedback: function(is_original) {
    this.show_wait("icon-refresh icon-spin color-info-light", 400, is_original);
    this.hide_wait(400, 1400, is_original);
  },

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

// Change query, this will be removed later when replaced with actual query system
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

function event_toggle_condensed() {
  $("i", this).toggleClass("icon-th-large icon-th");
  $("#content").toggleClass("view-condensed");
}

function event_toggle_fullscreen() {
  $("i", this).toggleClass("icon-fullscreen icon-resize-small");
  $("body").toggleClass("fullscreen");
}

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

function init_popovers($container) {
  var $hidden = $("#popover-elements"),
      $all_elems = $(),
      popover_elements = [
        {
          $elem: $("#btn-groups-filter"),
          title: "Filter Groups",
          $content: $("#popover-groups")
        },
        {
          $elem: $("#btn-change-workflow"),
          title: "Change workflow",
          $content: $("#popover-workflows")
        }
      ];

  $.each(popover_elements, function(i, pop) {
    $all_elems = $all_elems.add(pop.$elem);
    pop.$elem.popover({
      title: pop.title,
      html: true,
      container: "body",
      placement: "bottom",
      content: function() {
        return pop.$content;
      }
    }).on("hide.bs.popover", function() {
      $hidden.append(pop.$content);
    });
  });

  $all_elems.each(function() {
    $(this).on("click", function() {
      $all_elems.not(this).popover("hide");
      return false;
    });
  });
  $("#content.taskboard").on("click", function() {
    $all_elems.popover("hide");
  });
}

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
  });
}

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

function show_no_ticket_msg($container) {
  var $msg = $("<div class='box-info large take-color'>" +
                 "<h1><i class='icon-info-sign'></i> No Tickets Found</h1>" +
               "</div");
  $container.before($msg);
}