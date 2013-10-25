from agiletools.api import AgileToolsSystem

from trac.core import Component, implements, TracError
from trac.db.api import with_transaction
from trac.web import IRequestHandler, IRequestFilter
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

class BacklogModule(Component):
    implements(IRequestHandler, ITemplateProvider, IRequestFilter)

    #IRequestHandler methods
    def match_request(self, req):
        return req.path_info == "/backlog"

    def process_request(self, req):
        ats = AgileToolsSystem(self.env)

        if req.get_header('X-Requested-With') == 'XMLHttpRequest':
            if req.method == "POST":

                str_ticket= req.args.get("ticket")
                str_relative = req.args.get("relative")
                direction = req.args.get("relative_direction")

                if str_ticket and str_relative:
                    try:
                        ticket = int(str_ticket)
                        relative = int(str_relative)
                    except TypeError, ValueError:
                        self._json_error("Invalid arguments")
                        return

                    position = ats.position(relative, generate=True)
                    if direction == "after":
                        position += 1

                    ats.move(ticket, position, author=req.authname)
                    req.send(to_json({'success': True}), 'text/json')

                else:
                    self._json_error("No arguments supplied")
                    return
        else:
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
            add_script(req, "backlog/js/backlog_query.js")
        return (template, data, content_type)

    # ITemplateProvider methods
    def get_htdocs_dirs(self):
        return [('backlog', resource_filename(__name__, 'htdocs'))]

    def get_templates_dirs(self):
        return [resource_filename(__name__, 'templates')]

    # Own methods
    def _json_error(self, req, error):
        return req.send(to_json({'error': error}), 'text/json')
