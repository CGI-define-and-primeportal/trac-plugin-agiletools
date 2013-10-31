from agiletools.api import AgileToolsSystem

from trac.core import Component, implements, TracError
from trac.db.api import with_transaction
from trac.resource import ResourceNotFound
from trac.web import IRequestHandler, IRequestFilter
from trac.web.chrome import (ITemplateProvider, add_script, add_stylesheet,
                             add_script_data)
from trac.ticket.query import Query
from trac.ticket.model import Ticket, Milestone
from trac.ticket.api import TicketSystem
from trac.ticket.web_ui import TicketModule
from trac.util.presentation import to_json
from trac.web.chrome import Chrome
from logicaordertracker.controller import LogicaOrderController, Operation
from pkg_resources import resource_filename
from datetime import datetime
from trac.util.datefmt import to_utimestamp, utc
import re

class BacklogModule(Component):
    implements(IRequestHandler, ITemplateProvider, IRequestFilter)

    #IRequestHandler methods
    def match_request(self, req):
        return req.path_info == "/backlog"

    def process_request(self, req):
        req.perm.assert_permission('TICKET_VIEW')

        ats = AgileToolsSystem(self.env)

        if req.get_header('X-Requested-With') == 'XMLHttpRequest':

            if req.method == "POST":

                str_ticket= req.args.get("ticket")
                str_relative = req.args.get("relative", 0)
                direction = req.args.get("relative_direction")
                milestone = req.args.get("milestone")

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

                    # Change ticket's milestone
                    if milestone is not None:
                        try:
                            self._save_ticket(req, ticket, milestone)
                        except ValueError as e:
                            return self._json_errors(req, e.message)

                    # Reposition ticket
                    if int_relative:
                        position = ats.position(int_relative, generate=True)
                        if direction == "after":
                            position += 1

                        ats.move(int_ticket, position, author=req.authname)

                    self._json_send(req, {'success': True})

                else:
                    self._json_errors(req, ["Must provide a ticket"])
                    return

            else:

                fields = ("summary", "type", "component", "priority",
                      "priority_value", "changetime", "reporter",
                      "estimatedhours")

                milestone = req.args.get("milestone")

                # Do complete milestone request
                if milestone is not None:
                    con = { 'milestone': [milestone] }
                    query = Query(self.env, constraints=con, cols=fields, max=0)
                    results = query.execute(req)
                    tickets = self._get_ticket_data(req, fields, results)
                    self._json_send(req, {'tickets': tickets})
                else:
                    # Get an update from between two points
                    from_iso = req.args.get("from")
                    to_iso = req.args.get("to")
                    self.json_send(req, {'success': True})

        else:
            add_script(req, "agiletools/js/update_model.js")
            add_script(req, "agiletools/js/backlog.js")
            add_stylesheet(req, "agiletools/css/backlog.css")

            script_data = { 
                'milestones': Milestone.select_names_select2(self.env)
                }

            add_script_data(req, script_data)
            # Just post the basic template, with a list of milestones
            # The JS will then make a request for tickets in no milestone
            # and tickets in the most imminent milestone
            # The client will be able to make subsequent requests to pull
            # tickets from other milestones and drop tickets into them
            return "backlog.html", {}, None

    # IRequestFilter methods
    def pre_process_request(self, req, handler):
        return handler

    def post_process_request(self, req, template, data, content_type):
        if req.path_info == "/query" and data.get("dynamic_order"):
            add_script(req, "agiletools/js/backlog_query.js")
        return (template, data, content_type)

    # ITemplateProvider methods
    def get_htdocs_dirs(self):
        return [('agiletools', resource_filename(__name__, 'htdocs'))]

    def get_templates_dirs(self):
        return [resource_filename(__name__, 'templates')]

    # Own methods
    def _get_ticket_data(self, req, fields, results):
        ats = AgileToolsSystem(self.env)
        chrome = Chrome(self.env)
        tickets = []
        for result in results:
            filtered_result = dict((k, v)
                               for k, v in result.iteritems()
                               if k in fields)

            if "estimatedhours" in filtered_result:
                try:
                    hours = float(filtered_result["estimatedhours"])
                except (ValueError, TypeError):
                    hours = 0
                del filtered_result["estimatedhours"]
            else:
                hours = 0

            filtered_result.update({
                'id': result['id'],
                'position': ats.position(result['id']),
                'hours': hours,
                'reporter': chrome.authorinfo(req, filtered_result["reporter"]),
                'changetime': to_utimestamp(filtered_result['changetime'])
                })

            tickets.append(filtered_result)

        return tickets

    def _save_ticket(self, req, ticket, milestone):
        @self.env.with_transaction()
        def do_save(db):
            tm = TicketModule(self.env)
            req.args["milestone"] = milestone
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

    def _json_errors(self, req, error):
        return self._json_send(req, {'errors': error})

    def _json_send(self, req, dictionary):
        return req.send(to_json(dictionary), 'text/json')

