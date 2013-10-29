from agiletools.api import AgileToolsSystem

from autocompleteplugin.autocomplete import AutoCompleteSystem
from collections import defaultdict
from trac.core import Component, implements, TracError
from trac.config import ListOption
from trac.db.api import with_transaction
from trac.resource import ResourceNotFound
from trac.web import IRequestHandler
from trac.web.chrome import (ITemplateProvider, add_script, add_stylesheet,
                             add_script_data)
from trac.ticket.query import Query
from trac.ticket.model import Ticket, Milestone
from trac.ticket.api import TicketSystem
from trac.ticket.web_ui import TicketModule
from trac.util.presentation import to_json
from logicaordertracker.controller import LogicaOrderController, Operation
from pkg_resources import resource_filename
from datetime import datetime
from trac.util.datefmt import to_utimestamp, utc
import re


class TaskboardModule(Component):
    implements(IRequestHandler, ITemplateProvider)

    restricted_fields = ListOption("taskboard", "restricted_fields",
            default="statusgroup, workflow, resolution",
            doc="""fields that shouldn't be present
            on the taskboard, separated by ',')"""
            )
    user_fields = ListOption("taskboard", "user_fields",
            default="owner, reporter, qualityassurancecontact",
            doc="""fields whose values represent users, separated by ',')"""
            )

    @property
    def valid_fields(self):
        return [f for f in TicketSystem(self.env).get_ticket_fields()
                if (f.get("type") in ("select", "radio")
                or f.get("name") in self.user_fields)
                and f.get("name") not in self.restricted_fields]

    #IRequestHandler methods
    def match_request(self, req):
        return req.path_info == '/taskboard'

    def process_request(self, req):

        req.perm.assert_permission('TICKET_VIEW')

        req.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        req.send_header("Pragma", "no-cache")
        req.send_header("Expires", 0)

        xhr = req.get_header('X-Requested-With') == 'XMLHttpRequest'

        group_by = req.args.get("group", "status")

        milestones = Milestone.select_names_select2(self.env)
        milestone = req.args.get("milestone")
        milestone_not_found = False
        if milestone:
            try:
                Milestone(self.env, milestone)
            except ResourceNotFound:
                milestone_not_found = True
                milestone = None

        if not milestone and len(milestones["results"]):
            milestone = milestones["results"][0]["text"]

        # Pick up an Ajax post
        if req.args.get("ticket") and xhr:
            result = self.save_change(req, milestone)
            req.send(to_json(result), 'text/json')
        else:
            data = {}
            constr = {}

            if milestone:
                constr['milestone'] = [milestone]

            # If we're requesting an Ajax update, just send JSON
            if xhr:
                from_iso = req.args.get("from", "")
                to_iso = req.args.get("to", "")
                if from_iso and to_iso:
                    constr['changetime'] = [from_iso + ".." + to_iso]

            # Get all tickets by milestone
            query = Query(self.env, constraints=constr, max=300)

            r = query.execute(req)

            if r:
                script = self.get_ticket_data(req, milestone, group_by, r)
                script['total_tickets'] = len(r)
                data['cur_group'] = script['groupName']
            else:
                script = {}
                data['cur_group'] = group_by

            if xhr:
                if constr.get("changetime"):
                    script['otherChanges'] = \
                        self.all_other_changes(req, r, constr['changetime'])

                req.send(to_json(script), 'text/json')
            else:
                script.update({
                    'formToken': req.form_token,
                    'milestones': milestones
                })
                data.update({
                    'milestone_not_found': milestone_not_found,
                    'current_milestone': milestone,
                    'group_by_fields': self.valid_fields,
                })

                add_script(req, 'taskboard/js/taskboard.js')
                add_script_data(req, script)

                add_stylesheet(req, 'taskboard/css/taskboard.css')
                return "taskboard.html", data, None

    def all_other_changes(self, req, changed_in_scope, from_to):
        """Return tuple of ticket IDs changed outside of query scope.
        This is relevant because if a ticket moves out of scope we need to know
        about it so that it can be removed from the taskboard."""
        constraints = {'changetime': from_to}
        all_changes = Query(self.env, constraints=constraints).execute(req)
        scope_ids = [t["id"] for t in changed_in_scope]
        return [t["id"] for t in all_changes if t["id"] not in scope_ids]

    def get_ticket_data(self, req, milestone, grouped_by, results):
        """Return formatted data into single object to be used as JSON.
        Checks for a valid field (or groups by status).
        Then looks for a custom method for field, else uses standard method.
        """
        fields = ("summary", "milestone", "type", "component", "status",
                  "priority", "priority_value", "owner", "changetime")
        try:
            valid_group = next(field for field in self.valid_fields
                               if field.get("name") == grouped_by)
        except StopIteration:
            valid_group = next(field for field in self.valid_fields
                               if field.get("name") == "status")

        try:
            get_f = getattr(self, "_get_%s_data" % valid_group["name"])
        except AttributeError:
            if valid_group["name"] in self.user_fields:
                get_f = self._get_user_data_
            else:
                get_f = self._get_standard_data_
        return self._formatted_data(get_f(req, milestone, valid_group, results, fields))

    def _get_standard_data_(self, req, milestone, field, results, fields):
        ats = AgileToolsSystem(self.env)
        tickets_json = defaultdict(lambda: defaultdict(dict))

        # Allow for the unset option
        options = [""] + [option for option in field["options"]]

        for result in results:
            ticket = Ticket(self.env, result['id'])
            filtered_result = dict((k, v)
                                   for k, v in result.iteritems()
                                   if k in fields)
            filtered_result['position'] = ats.position(result['id'])
            filtered_result['changetime'] = to_utimestamp(result['changetime'])
            group_field_val = ticket.get_value_or_default(field["name"]) or ""
            tickets_json[group_field_val][result["id"]] = filtered_result

        return (field["name"], tickets_json, options)

    def _get_user_data_(self, req, milestone, field, results, fields):
        """Get data grouped by users. Should include extra user info"""
        ats = AgileToolsSystem(self.env)
        tickets_json = defaultdict(lambda: defaultdict(dict))

        all_users = AutoCompleteSystem(self.env)._project_users
        most_popular_group = max(all_users, key=lambda x: len(x))

        options = [""]
        user_data = {}
        use_avatar = self.config.get('avatar','mode').lower() != 'off'
        for user in all_users[most_popular_group]:
            options.append(user["sid"])
            user_data[user["sid"]] = {
                'name': user["name"],
                'avatar': use_avatar and req.href.avatar(user["sid"]) or None
            }

        for result in results:
            ticket = Ticket(self.env, result['id'])
            filtered_result = dict((k, v)
                                   for k, v in result.iteritems()
                                   if k in fields)
            filtered_result['position'] = ats.position(result['id'])
            filtered_result['changetime'] = to_utimestamp(result['changetime'])
            group_field_val = ticket.get_value_or_default(field["name"]) or ""
            tickets_json[group_field_val][result["id"]] = filtered_result

        return (field["name"], tickets_json, options, user_data)

    def _get_status_data(self, req, milestone, field, results, fields):
        """Get data grouped by WORKFLOW and status.
        It's not possible to show tickets in different workflows on the same
        taskboard, so we create an additional outer group for workflows.
        We then get the workflow with the most tickets, and show that first"""
        ats = AgileToolsSystem(self.env)
        loc = LogicaOrderController(self.env)

        # Data for status much more complex as we need to track the workflow
        tickets_json = defaultdict(lambda: defaultdict(dict))
        by_type = defaultdict(int)
        by_wf = defaultdict(int)
        wf_for_type = {}

        # Store the options required in order to complete an action
        # E.g. closing a ticket requires a resolution
        act_controls = {}

        for r in results:
            # Increment type statistics
            by_type[r['type']] += 1
            tkt = Ticket(self.env, r['id'])
            if r['type'] not in wf_for_type:
                wf_for_type[r['type']] = \
                    loc._get_workflow_for_typename(r['type'])
            wf = wf_for_type[r['type']]

            state = loc._determine_workflow_state(tkt, req=req)
            op = Operation(self.env, wf, state)
            filtered = dict((k, v)
                            for k, v in r.iteritems()
                            if k in fields)
            filtered['position'] = ats.position(r['id'])
            filtered['changetime'] = to_utimestamp(r['changetime'])
            filtered['actions'] = self._get_status_actions(req, op, wf, state)
            # Collect all actions requiring further input
            self._update_controls(req, act_controls, filtered['actions'], tkt)

            tickets_json[wf.name][r["status"]][r["id"]] = filtered

        # Calculate number of tickets per workflow
        for ty in by_type:
            by_wf[wf_for_type[ty]] += by_type[ty]

        wf_statuses = dict((wf.name, wf.ordered_statuses) for wf in by_wf)

        # Retrieve Kanban-style status limits
        db = self.env.get_read_db()
        cursor = db.cursor()
        cursor.execute("""
            SELECT status, hardlimit FROM kanban_limits
            WHERE milestone = %s""", (milestone,))
        status_limits = dict((limit[0], limit[1]) for limit in cursor)

        # Initially show the most used workflow
        show_first = max(by_wf, key=lambda n: by_wf[n]).name
        return ("status", tickets_json, wf_statuses, status_limits, show_first, act_controls)

    def _get_status_actions(self, req, op, workflow, state):
        """Get all statuses a ticket can move to, and the actions for each."""
        actions = {}
        for (action, label) in workflow.form_buttons(state):
            changes = op.workflow_changes(action)
            # Find all the valid statuses for this ticket
            if 'status' in changes:
                # Can invoke multiple operations, sometimes requiring
                # Further input, e.g. closing a ticket reqs a resolution
                action_ops = [value[0] for k, values
                              in op.get_action(action).iteritems()
                              for value in values
                              if k == 'operations']
                actions[changes['status']] = (action, action_ops)
        return actions

    def _update_controls(self, req, action_controls, actions, tkt):
        """Given actions list, update action_controls w all requiring input
           c[2] is HTML inputs required before an action can be completed.
           If it exists, we make a note of the action operation."""
        tm = TicketModule(self.env)
        for (act, act_ops) in actions.itervalues():
            for act_op in act_ops:
                if act_op not in action_controls:
                    control = list(tm.get_action_control(req, act, tkt))
                    control[2] = str(control[2])
                    if control[2]:
                        action_controls[act_op] = control

    def _formatted_data(self, data):
        """Given data tuple, return data dict to be used as script data."""
        formatted = {}
        if data[0] == "status":
            (group_name, tickets, groups, status_limits, show_first, op_options) = data
            formatted['statusLimits'] = status_limits
            formatted['workflowStatuses'] = {}
            formatted['currentWorkflow'] = show_first
            formatted['operationOptions'] = op_options
        elif data[0] in self.user_fields:
            (group_name, tickets, groups, user_data) = data
            formatted['userData'] = user_data
        else:
            (group_name, tickets, groups) = data

        formatted.update({
            'tickets': tickets,
            'groupName': group_name,
            'groups': groups,
        })

        return formatted

    def save_change(self, req, milestone):
        """Try to save changes and return new data, else return error dict.
        As with getting ticket data, we check for a custom save method,
        and else use the standard implementation
        """
        try:
            ticket_id = int(req.args.get("ticket"))
        except (ValueError, TypeError):
            return self._save_error(req, ["Must supply a ticket to change"])

        field = req.args.get("group_name")
        if not field or re.search("[^a-z0-9]", field):
            return self._save_error(req, ["Invalid field name"])
        else:
            # Check to see if we process this field in a unique way
            try:
                save_f = getattr(self, "_save_%s_change" % field)
            except AttributeError:
                save_f = self._save_standard_change_

            # Try to save the ticket using the relevant save method
            try:
                if save_f.__name__ == "_save_standard_change_":
                    save_f(req, ticket_id, field, req.args.get("value"))
                else:
                    save_f(req, ticket_id, req.args.get("action"))

                # Retrieve new ticket information
                query = Query(self.env, constraints={'id': [str(ticket_id)]})
                results = query.execute(req)
                return self.get_ticket_data(req, milestone, field, results)
            except ValueError, e:
                return self._save_error(req, list(e))
            except TracError, e:
                return self._save_error(req, [e])

    def _save_standard_change_(self, req, ticket_id, field, new_value):
        @with_transaction(self.env)
        def _implementation(db):
            tkt = Ticket(self.env, ticket_id)
            tm = TicketModule(self.env)
            req.args[field] = new_value
            tm._populate(req, tkt, plain_fields=True)

            changes, problems = tm.get_ticket_changes(req, tkt, "btn_save")

            if problems:
                raise ValueError(problems)

            tm._apply_ticket_changes(tkt, changes)
            valid = tm._validate_ticket(req, tkt, force_collision_check=True)
            if not valid:
                raise ValueError(req.chrome['warnings'])
            else:
                tkt.save_changes(req.authname, "", when=datetime.now(utc))

    def _save_status_change(self, req, ticket_id, action):
        @with_transaction(self.env)
        def _implementation(db):
            tkt = Ticket(self.env, ticket_id)
            ts = TicketSystem(self.env)
            tm = TicketModule(self.env)
            if action not in ts.get_available_actions(req, tkt):
                raise ValueError(["This ticket cannot be moved to this status,\
                      perhaps the ticket has been updated by someone else."])

            field_changes, problems = \
                tm.get_ticket_changes(req, tkt, action)

            if problems:
                raise ValueError(problems)

            tm._apply_ticket_changes(tkt, field_changes)
            valid = tm._validate_ticket(req, tkt, force_collision_check=True)
            if not valid:
                raise ValueError(req.chrome['warnings'])
            else:
                tkt.save_changes(req.authname, "", when=datetime.now(utc))

    def _save_error(self, req, error):
        return {'error': error}

    # ITemplateProvider methods
    def get_htdocs_dirs(self):
        return [('taskboard', resource_filename(__name__, 'htdocs'))]

    def get_templates_dirs(self):
        return [resource_filename(__name__, 'templates')]
