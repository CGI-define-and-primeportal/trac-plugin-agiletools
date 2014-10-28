from agiletools.api import AgileToolsSystem

from trac.core import Component, implements, TracError
from trac.db.api import with_transaction
from trac.resource import ResourceNotFound
from trac.web import IRequestHandler, IRequestFilter
from trac.web.chrome import (ITemplateProvider, add_script, add_stylesheet,
                             add_script_data)
from trac.ticket.query import Query
from trac.ticket.model import Ticket, Milestone
from trac.ticket.web_ui import TicketModule
from trac.util.presentation import to_json
from pkg_resources import resource_filename
from datetime import datetime
from trac.util.datefmt import to_utimestamp, utc
from trac.web.session import DetachedSession

from logicaordertracker.controller import LogicaOrderController

class BacklogModule(Component):
    implements(IRequestHandler, ITemplateProvider, IRequestFilter)

    fields = ("summary", "type", "component", "priority", "priority_value", 
              "changetime", "reporter", "remaininghours", "status")

    #IRequestHandler methods
    def match_request(self, req):
        return req.path_info == "/backlog"

    def process_request(self, req):

        req.perm.assert_permission('BACKLOG_VIEW')

        ats = AgileToolsSystem(self.env)

        if req.get_header('X-Requested-With') == 'XMLHttpRequest':

            if req.method == "POST":

                if not req.perm.has_permission("BACKLOG_ADMIN"):
                    return self._json_errors(req, ["BACKLOG_ADMIN permission required"])

                str_ticket= req.args.get("ticket")
                str_relative = req.args.get("relative", 0)
                direction = req.args.get("relative_direction")
                milestone = req.args.get("milestone")

                # Moving a single ticket position (and milestone)
                if str_ticket:
                    try:
                        int_ticket = int(str_ticket)
                        int_relative = int(str_relative)
                    except (TypeError, ValueError):
                        return self._json_errors(req, ["Invalid arguments"])

                    try:
                        ticket = Ticket(self.env, int_ticket)
                    except ResourceNotFound:
                        return self._json_errors(req, ["Not a valid ticket"])

                    response = {}

                    # Change ticket's milestone
                    if milestone is not None:
                        try:
                            self._save_ticket(req, ticket, milestone)
                            ticket = self._get_permitted_tickets(req, constraints={'id': [str(int_ticket)]})
                            response['tickets'] = self._get_ticket_data(req, ticket)
                        except ValueError as e:
                            return self._json_errors(req, e.message)

                    # Reposition ticket
                    if int_relative:
                        position = ats.position(int_relative, generate=True)
                        if direction == "after":
                            position += 1

                        ats.move(int_ticket, position, author=req.authname)
                        response['success'] = True

                    return self._json_send(req, response)

                # Dropping multiple tickets into a milestone
                elif all (k in req.args for k in ("tickets", "milestone", "changetimes")):

                    changetimes = req.args["changetimes"].split(",")
                    milestone = req.args["milestone"]

                    try:
                        ids = [int(tkt_id) for tkt_id in req.args["tickets"].split(",")]
                    except (ValueError, TypeError):
                        return self._json_errors(req, ["Invalid arguments"])

                    unique_errors = 0
                    errors_by_ticket = []
                    # List of [<ticket_id>, [<error>, ...]] lists
                    if len(ids) == len(changetimes):
                        for i, int_ticket in enumerate(ids):
                            # Valid ticket
                            try:
                                ticket = Ticket(self.env, int_ticket)
                            except ResourceNotFound:
                                errors_by_ticket.append([int_ticket, ["Not a valid ticket"]])
                            # Can be saved
                            try:
                                self._save_ticket(req, ticket, milestone, ts=changetimes[i])
                            except ValueError as e:
                                # Quirk: all errors amalgomated into single
                                # we keep track of count at each time so that
                                # we can split the list up to errors by
                                # individual tickets
                                errors_by_ticket.append([int_ticket, e.message[unique_errors:]])
                                unique_errors = len(e.message)
                                if len(errors_by_ticket) > 5:
                                    errors_by_ticket.append("More than 5 tickets failed "
                                                            "validation, stopping.")
                                    break
                        if errors_by_ticket:
                            return self._json_errors(req, errors_by_ticket)
                        else:
                            # Client side makes additional request for all
                            # tickets after this
                            return self._json_send(req, {'success': True})
                    else:
                        return self._json_errors(req, ["Invalid arguments"])
                else:
                    return self._json_errors(req, ["Must provide a ticket"])
            else:
                # TODO make client side compatible with live updates
                milestone = req.args.get("milestone")
                from_iso = req.args.get("from")
                to_iso = req.args.get("to")

                if milestone is not None:
                    # Requesting an update
                    constr = { 'milestone': [milestone] }
                    if from_iso and to_iso:
                        constr['changetime'] = [from_iso + ".." + to_iso]

                    tickets = self._get_permitted_tickets(req, constraints=constr)
                    formatted = self._get_ticket_data(req, tickets)
                    self._json_send(req, {'tickets': formatted})
                else:
                    self._json_errors(req, ["Invalid arguments"])

        else:
            add_script(req, 'agiletools/js/jquery.history.js')
            add_script(req, "agiletools/js/update_model.js")
            add_script(req, "agiletools/js/backlog.js")
            add_stylesheet(req, "agiletools/css/backlog.css")

            milestones_select2 = Milestone.select_names_select2(self.env, include_complete=False)
            milestones_select2['results'].insert(0, {
                "children": [],
                "text": "Product Backlog",
                "id": "backlog",
                "is_backlog": True,
            })

            milestones_flat = [milestone.name for milestone in
                               Milestone.select(self.env, include_completed=False, include_children=True)]

            script_data = { 
                'milestones': milestones_select2,
                'milestonesFlat': milestones_flat,
                'backlogAdmin': req.perm.has_permission("BACKLOG_ADMIN")
                }

            add_script_data(req, script_data)
            data = {'top_level_milestones': Milestone.select(self.env)}
            # Just post the basic template, with a list of milestones
            # The JS will then make a request for tickets in no milestone
            # and tickets in the most imminent milestone
            # The client will be able to make subsequent requests to pull
            # tickets from other milestones and drop tickets into them
            return "backlog.html", data, None

    # IRequestFilter methods
    def pre_process_request(self, req, handler):
        return handler

    def post_process_request(self, req, template, data, content_type):
        if req.path_info == "/query" \
                and data and data.get("dynamic_order") \
                and req.perm.has_permission("BACKLOG_ADMIN"):
            add_script(req, "agiletools/js/backlog_query.js")
        return (template, data, content_type)

    # ITemplateProvider methods
    def get_htdocs_dirs(self):
        return [('agiletools', resource_filename(__name__, 'htdocs'))]

    def get_templates_dirs(self):
        return [resource_filename(__name__, 'templates')]

    # Own methods
    def _get_ticket_data(self, req, results):
        ats = AgileToolsSystem(self.env)
        loc = LogicaOrderController(self.env)
        closed_statuses = loc.type_and_statuses_for_closed_statusgroups()

        # TODO calculate which statuses are closed using the query system
        # when it is able to handle this
        tickets = []
        for result in results:
            if result['status'] not in closed_statuses[result['type']]:
                filtered_result = dict((k, v)
                                   for k, v in result.iteritems()
                                   if k in self.fields)

                if "remaininghours" in filtered_result:
                    try:
                        hours = float(filtered_result["remaininghours"])
                    except (ValueError, TypeError):
                        hours = 0
                    del filtered_result["remaininghours"]
                else:
                    hours = 0

                reporter = filtered_result["reporter"]
                session = DetachedSession(self.env, reporter)

                filtered_result.update({
                    'id': result['id'],
                    'position': ats.position(result['id']),
                    'hours': hours,
                    'reporter': session.get('name', reporter),
                    'changetime': to_utimestamp(filtered_result['changetime'])
                    })

                tickets.append(filtered_result)

        return tickets

    def _save_ticket(self, req, ticket, milestone, ts=None):
        @self.env.with_transaction()
        def do_save(db):
            tm = TicketModule(self.env)
            req.args["milestone"] = milestone

            if ts:
                req.args["ts"] = ts
                
            tm._populate(req, ticket, plain_fields=True)

            changes, problems = tm.get_ticket_changes(req, ticket, "btn_save")

            if problems:
                raise ValueError(problems)

            tm._apply_ticket_changes(ticket, changes)
            valid = tm._validate_ticket(req, ticket, force_collision_check=True)
            if not valid:
                raise ValueError(req.chrome['warnings'])
            else:
                ticket.save_changes(req.authname, "", when=datetime.now(utc))

    def _get_permitted_tickets(self, req, constraints=None):
        qry = Query(self.env, constraints=constraints, cols=self.fields, max=0)
        return [ticket for ticket in qry.execute(req)
                if 'TICKET_VIEW' in req.perm('ticket', ticket['id'])]

    def _json_errors(self, req, error):
        return self._json_send(req, {'errors': error})

    def _json_send(self, req, dictionary):
        return req.send(to_json(dictionary), 'text/json')

