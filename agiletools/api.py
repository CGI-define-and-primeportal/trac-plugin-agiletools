#
# Copyright (C) 2013 CGI IT UK Ltd
# All rights reserved.
#

from trac.web.api import ITemplateStreamFilter, IRequestFilter
from trac.core import Component, implements, TracError, Interface, ExtensionPoint
from trac.db import DatabaseManager
from trac.env import IEnvironmentSetupParticipant

from agiletools import db_default

class AgileToolsSystem(Component):
    implements(IEnvironmentSetupParticipant)
    
    # IEnvironmentSetupParticipant
    def environment_created(self):
        @self.env.with_transaction()
        def do_db_create(db):
            db_manager, _ = DatabaseManager(self.env)._get_connector()
            cursor = db.cursor()
            for table in db_default.schema:
                for sql in db_manager.to_sql(table):
                    cursor.execute(sql)
            cursor.execute('INSERT INTO system (name, value) VALUES (%s, %s)',
                           (db_default.name, db_default.version))

    def environment_needs_upgrade(self, db):
        cursor = db.cursor()
        cursor.execute('SELECT value FROM system WHERE name in (%s, %s)',
                       (db_default.old_name, db_default.name,))
        value = cursor.fetchone()
        if not value:
            self.found_db_version = 0
        else:
            self.found_db_version = int(value[0])

        if self.found_db_version < db_default.version:
            return True
        elif self.found_db_version > db_default.version:
            raise TracError('Database newer than %s version', db_default.name)
        else:
            return False

    def upgrade_environment(self, db):
        if self.found_db_version == 0:
            self.environment_created()
            return

        cursor = db.cursor()
        for i in range(self.found_db_version+1, db_default.version+1):
            name = 'db%i' % i
            try:
                upgrades = __import__('upgrades', globals(), locals(), [name])
                script = getattr(upgrades, name)
            except AttributeError:
                raise TracError('No upgrade module for %s version %i',
                                db_default.name, i)
            script.do_upgrade(self.env, i, cursor)
            cursor.execute('UPDATE system SET value=%s WHERE name=%s',
                           (db_default.version, db_default.name))
            db.commit()
            self.log.info('Upgraded %s database version from %d to %d', 
                          db_default.name, i-1, i)

    # own methods
    def insert_before(self, grouping, ticket, before_ticket):

        self.log.debug("Moving ticket %d to before %d for %s", 
                       ticket, before_ticket, grouping)

        @with_transaction(self.env)
        def do_insert_before(db):
            cursor = db.cursor()

            cursor.execute("SELECT position FROM ticket_positions WHERE grouping = %s LIMIT 1",
                           (grouping,))

            if not cursor.fetchone():
                # we can't move a ticket until we have stored a default order for all tickets
                # hopefully we'll come up with a faster way to do this which works for both
                # sqlite and postgresql
                # and maybe doesn't have to assume the default ordering was priority then id
                self.log.warning("No positioning data available, copying default ordering into positioning table")
                cursor.execute("""
                 SELECT id,
                        COALESCE(priority.value,'')='' AS _o_1,
                        CAST(priority.value AS integer) AS _o_2
                 FROM ticket
                 LEFT OUTER JOIN enum AS priority ON (priority.type='priority' AND priority.name=priority)
                 ORDER BY COALESCE(priority.value,'')='',CAST(priority.value AS integer), id
                """)
                orders = []
                for r in enumerate(cursor.fetchall()):
                    orders.append((grouping, r[0], r[1][0]))
                cursor.executemany("INSERT INTO ticket_positions (grouping, position, ticket) VALUES (%s,%s,%s)",
                                   orders)

            cursor.execute("SELECT position FROM ticket_positions WHERE grouping = %s and ticket = %s",
                           (grouping, before_ticket))
            before_position = cursor.fetchone()

            if not before_position:
                # maybe we're putting our ticket before one that is recently inserted to the ticket database
                before_position = [0]

            # TODO deal with moving positions down too, to avoid growing without bounds
            cursor.execute("UPDATE ticket_positions SET position = position + 1 WHERE position >= %s AND grouping = %s", (before_position[0], grouping))
            cursor.execute("DELETE FROM ticket_positions WHERE grouping = %s and ticket = %s",
                           (grouping, ticket))
            cursor.execute("INSERT INTO ticket_positions (grouping, ticket, position) VALUES (%s,%s,%s)",
                           (grouping, ticket, before_position[0]))

