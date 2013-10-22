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
    def insert_before(self, ticket, before_ticket):

        self.log.debug("Moving ticket %d to before %d",
                       ticket, before_ticket)

        @self.env.with_transaction()
        def do_insert_before(db):

            cursor = db.cursor()
            cursor.execute("""
                            SELECT position FROM ticket_positions
                            WHERE ticket = %s""", (before_ticket, ))

            before_position = cursor.fetchone()

            # If our before ticket isn't yet sorted, then we have an issue
            # we need to calculate where it's psuedo-position is (which
            # depends on it's priority and ID) and assign the ticket _and_
            # all those unsorted which have higher psuedo-positions (higher 
            # prio, higher ID) a fixed position

            if not before_position:

                cursor.execute("SELECT MAX(position) FROM ticket_positions")
                last = cursor.fetchone()
                start = (last[0] or 0) + 1

                before_position = [start]

                # Find all unsorted tickets
                cursor.execute("""
                    SELECT id,
                        CAST(COALESCE(priority.value,999) AS int) AS prio
                    FROM ticket
                    LEFT OUTER JOIN enum AS priority
                        ON (priority.type='priority' AND priority.name=priority)
                    LEFT OUTER JOIN ticket_positions AS positions
                        ON (positions.ticket=id)
                    WHERE positions.position IS NULL
                    ORDER BY prio, id""")

                positions = []

                for i, row in enumerate(cursor):
                    positions.append((row[0], start + i))

                    # We've reached our before ticket, don't fix any more
                    if row[0] == before_ticket:
                        before_position = [start + i]
                        break

                cursor.executemany("""
                    INSERT INTO ticket_positions (ticket, position)
                    VALUES (%s,%s)""", positions)

            # Move all tickets below our before ticket down on (open up a gap)
            # The gap shouldn't be important as we only care about the order
            cursor.execute("""
                            UPDATE ticket_positions
                            SET position = position + 1
                            WHERE position >= %s""", (before_position[0], ))

            cursor.execute("""
                            DELETE FROM ticket_positions
                            WHERE ticket = %s""", (ticket, ))

            cursor.execute("""
                            INSERT INTO ticket_positions (ticket, position)
                            VALUES (%s,%s)""", (ticket, before_position[0], ))
