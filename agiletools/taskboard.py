from agiletools.api import AgileToolsSystem

from collections import defaultdict
from trac.core import Component, implements, TracError
from trac.config import ListOption
from trac.db.api import with_transaction
from trac.resource import ResourceNotFound
from trac.web import IRequestHandler
from trac.web.chrome import (ITemplateProvider, add_script, add_stylesheet,
                             add_script_data, add_ctxtnav)
from trac.ticket.query import Query
from trac.ticket.model import Ticket, Milestone
from trac.ticket.api import TicketSystem
from trac.ticket.web_ui import TicketModule
from trac.util.presentation import to_json
from trac.util.translation import _
from logicaordertracker.controller import LogicaOrderController, Operation
from pkg_resources import resource_filename
from datetime import datetime
from genshi.builder import tag
from trac.util.datefmt import to_utimestamp, utc
import re

from simplifiedpermissionsadminplugin.simplifiedpermissions import SimplifiedPermissions

class TaskboardModule(Component):
    implements(IRequestHandler, ITemplateProvider)

    restricted_fields = ListOption("taskboard", "restricted_fields",
            default="statusgroup, workflow, resolution, type, milestone",
            doc="""fields that shouldn't be present
            on the taskboard, separated by ',')"""
            )
    user_fields = ListOption("taskboard", "user_fields",
            default="owner, reporter, qualityassurancecontact",
            doc="""fields whose values represent users, separated by ',')"""
            )

    @property
    def valid_fields(self):
        """All fields with discrete values which aren't in restricted list"""
        return [f for f in TicketSystem(self.env).get_ticket_fields()
                if (f.get("type") in ("select", "radio")
                or f.get("name") in self.user_fields)
                and f.get("name") not in self.restricted_fields]

    #IRequestHandler methods
    def match_request(self, req):
        return req.path_info.startswith('/taskboard')

    def process_request(self, req):

        req.perm.assert_permission('TICKET_VIEW')

        # set the default user query
        if req.path_info == '/taskboard/set-default-query' and req.method == 'POST':
            self._set_default_query(req)

        # these headers are only needed when we update tickets via ajax
        req.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        req.send_header("Pragma", "no-cache")
        req.send_header("Expires", 0)

        xhr = req.get_header('X-Requested-With') == 'XMLHttpRequest'

        group_by = req.args.get("group", "status")

        milestones = Milestone.select_names_select2(self.env, include_complete=False)

        # Try to find a user selected milestone in request - if not found 
        # check session_attribute for a user saved default, and if that is also
        # not found and fall back on the most upcoming milestone by due date
        milestone = req.args.get("milestone")
        milestone_not_found = False
        if milestone:
            try:
                Milestone(self.env, milestone)
            except ResourceNotFound:
                milestone_not_found = True
                milestone = None

        if not milestone:
            # try and find a user saved default
            default_milestone = req.session.get('taskboard_user_default_milestone')
            if default_milestone:
                milestone = default_milestone
                group_by = req.session.get('taskboard_user_default_group')

            # fall back to most imminent milestone by due date
            elif len(milestones["results"]):
                milestone = milestones["results"][0]["text"]

        # Ajax post
        if req.args.get("ticket") and xhr:
            result = self.save_change(req, milestone)
            req.send(to_json(result), 'text/json')
        else:
            data = {}
            constr = {}

            if milestone:
                constr['milestone'] = [milestone]

            # Ajax update: tickets changed between a period
            if xhr:
                from_iso = req.args.get("from", "")
                to_iso = req.args.get("to", "")
                if from_iso and to_iso:
                    constr['changetime'] = [from_iso + ".." + to_iso]

            # Get all tickets by milestone
            tickets = self._get_permitted_tickets(req, constraints=constr)

            if tickets:
                s_data = self.get_ticket_data(req, milestone, group_by, tickets)
                s_data['total_tickets'] = len(tickets)
                data['cur_group'] = s_data['groupName']
            else:
                s_data = {}
                data['cur_group'] = group_by

            if xhr:
                if constr.get("changetime"):
                    s_data['otherChanges'] = \
                        self.all_other_changes(req, tickets, constr['changetime'])

                req.send(to_json(s_data), 'text/json')
            else:
                s_data.update({
                    'formToken': req.form_token,
                    'milestones': milestones,
                    'milestone': milestone,
                    'group': group_by,
                })
                data.update({
                    'milestone_not_found': milestone_not_found,
                    'current_milestone': milestone,
                    'group_by_fields': self.valid_fields,
                })

                add_script(req, 'agiletools/js/update_model.js')
                add_script(req, 'agiletools/js/taskboard.js')
                add_script_data(req, s_data)

                add_stylesheet(req, 'agiletools/css/taskboard.css')
                add_stylesheet(req, 'common/css/ticket.css')
                add_ctxtnav(req, tag.a(tag.i(class_='icon-bookmark'),
                                       _(" Set as default"),
                                       id_='set-default-query',
                                       title=_("Make this your default query")))
                return "taskboard.html", data, None

    def _get_permitted_tickets(self, req, constraints=None):
        query = Query(self.env, constraints=constraints, max=0)
        return [ticket for ticket in query.execute(req)
                if 'TICKET_VIEW' in req.perm('ticket', ticket['id'])]

    def all_other_changes(self, req, changed_in_scope, from_to):
        """Return tuple of ticket IDs changed outside of query scope.

        This is relevant because if a ticket moves out of scope we need to know
        about it so that it can be removed from the taskboard."""
        constraints = {'changetime': from_to}
        all_changes = self._get_permitted_tickets(req, constraints=constraints)
        scope_ids = [t["id"] for t in changed_in_scope]
        return [t["id"] for t in all_changes if t["id"] not in scope_ids]

    def _set_default_query(self, req):
        """Processes a POST request to save a user based query on the task 
        board. After validating the milestone and group_by values, the 
        session_attribute table is updated and a JSON repsonse returned."""

        data = {}
        default_milestone = req.args.get('milestone')
        default_group = req.args.get('group')

        if default_milestone and default_group:

            try:
                Milestone(self.env, default_milestone)
            except ResourceNotFound:
                data['taskboard_default_updated'] = False

            if not default_group in [f['name'] for f in self.valid_fields]:
                data['taskboard_default_updated'] = False

            if not data:
                req.session['taskboard_user_default_milestone'] = default_milestone
                req.session['taskboard_user_default_group'] = default_group
                req.session.save()
                data['taskboard_default_updated'] = True

        else:
            data['taskboard_default_updated'] = False

        req.send(to_json(data), 'text/json')

    def get_ticket_data(self, req, milestone, grouped_by, results):
        """Return formatted data into single object to be used as JSON.

        Checks for a valid field (or groups by status).
        Then looks for a custom method for field, else uses standard method.
        """
        visible_fields = ("summary", "milestone", "type", "component", "status",
                  "priority", "priority_value", "owner", "changetime")

        # Try to group tickets by a user-specified valid field
        # if the field doesn't exist, we fall back to grouping by status
        group_by = None

        for field in self.valid_fields:
            name = field.get("name")
            if name in (grouped_by, "status"):
                group_by = field
                if name == grouped_by:
                    break

        # Look for a custom get method, based on the valid group
        try:
            get_f = getattr(self, "_get_%s_data" % group_by["name"])
        except AttributeError:
            if group_by["name"] in self.user_fields:
                get_f = self._get_user_data_
            else:
                get_f = self._get_standard_data_

        ticket_data = get_f(req, milestone, group_by, results, visible_fields)
        return self._formatted_data(ticket_data)

    def _get_standard_data_(self, req, milestone, field, results, fields):
        """Get ticket information when no custom grouped-by method present."""
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
        """Get data grouped by users. Includes extra user info."""
        ats = AgileToolsSystem(self.env)
        sp = SimplifiedPermissions(self.env)

        tickets_json = defaultdict(lambda: defaultdict(dict))

        all_users = []
        user_data = {}
        use_avatar = self.config.get('avatar','mode').lower() != 'off'

        # TODO: allow the task board to respect user groups
        for group, data in sp.group_memberships().items():
            for member in data['members']:
                if member.sid not in user_data:
                    all_users.append(member.sid);
                    user_data[member.sid] = {
                        'name': member.get("name", member.sid),
                        'avatar': use_avatar and req.href.avatar(member.sid) or None
                    }

        def name_for_sid(sid):
            return user_data[sid]["name"] if sid in user_data else sid

        options = [""] + sorted(all_users, key=name_for_sid)

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
        """Given list of actions, update action_controls w/all requiring input.

        control[2] represents HTML inputs required before an action can be
        completed. If it exists, we make a note of the action operation."""
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
        if not field or re.search("[^a-zA-Z0-9_]", field):
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
        return [('agiletools', resource_filename(__name__, 'htdocs'))]

    def get_templates_dirs(self):
        return [resource_filename(__name__, 'templates')]
