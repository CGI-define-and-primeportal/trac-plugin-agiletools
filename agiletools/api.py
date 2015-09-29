#
# Copyright (C) 2013 CGI IT UK Ltd
# All rights reserved.
#

from datetime import datetime

from trac.core import Component, implements, TracError
from trac.db import DatabaseManager
from trac.env import IEnvironmentSetupParticipant
from trac.util.datefmt import to_utimestamp, utc

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
    def position(self, ticket, generate=False):
        db = self.env.get_read_db()
        cursor = db.cursor()
        cursor.execute("""
                        SELECT position FROM ticket_positions
                        WHERE ticket = %s""", (ticket, ))

        position = (cursor.fetchone() or [None])[0]

        # When we insert a ticket at a position, we often want it to be 
        # relative to another ticket. This method allows us to ensure that
        # our relative ticket _always_ has an explicit position
        if generate and position is None:

            cursor.execute("SELECT MAX(position) FROM ticket_positions")
            last = cursor.fetchone()
            new_position = start = last[0] + 1 if last[0] else 0

            # Find all unsorted tickets
            cursor.execute("""
                SELECT id,
                    CAST(COALESCE(priority.value,'999') AS int) AS prio
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
                if row[0] == ticket:
                    new_position = start + i
                    break

            @self.env.with_transaction()
            def do_set_ticket_position(db):
                cursor = db.cursor()
                cursor.executemany("""
                    INSERT INTO ticket_positions (ticket, position)
                    VALUES (%s,%s)""", positions)

            return new_position

        return position

    def move(self, ticket, position, author=None, when=None):
        self.log.debug("Moving ticket %d to position %d",
                       ticket, position)

        if when is None:
            when = datetime.now(utc)
        when_ts = to_utimestamp(when)

        old_position = self.position(ticket)
        old_is_set = old_position is not None

        if position == old_position:
            return

        @self.env.with_transaction()
        def do_move(db):

            cursor = db.cursor()

            # If we're moving a ticket is moving down then we handle it
            # differently. In particular we decrement the position by one
            # as all tickets get shifted up one when it's moved from it's old
            # position
            moving_up = not old_is_set or position < old_position
            new_position = position if moving_up else position - 1

            if old_is_set:
                cursor.execute("""
                                DELETE FROM ticket_positions
                                WHERE ticket = %s""", (ticket, ))

            if moving_up:

                if old_is_set:
                    cursor.execute("""
                                    UPDATE ticket_positions
                                    SET position = position + 1
                                    WHERE position BETWEEN %s and %s""",
                                    (position, old_position))
                else:
                    cursor.execute("""
                                    UPDATE ticket_positions
                                    SET position = position + 1
                                    WHERE position >= %s""",
                                    (position, ))

            else:
                cursor.execute("""
                                UPDATE ticket_positions
                                SET position = position - 1
                                WHERE position BETWEEN %s and %s""",
                                (old_position, new_position))

            cursor.execute("""
                            INSERT INTO ticket_positions (ticket, position)
                            VALUES (%s,%s)""", (ticket, new_position))

            # Log the move
            cursor.execute("""
                            INSERT INTO ticket_positions_change
                                (ticket, time, author, oldposition, newposition)
                            VALUES (%s, %s, %s, %s, %s)""",
                            (ticket, when_ts, author, old_position, new_position))
