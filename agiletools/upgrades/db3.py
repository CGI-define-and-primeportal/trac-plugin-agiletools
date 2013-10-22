from trac.db import Table, Column, Index, DatabaseManager

def do_upgrade(env, ver, cursor):
    """Remove the grouping column and add keys
    """
    cursor.execute("CREATE TEMPORARY TABLE ticket_positions_old "
                   "AS SELECT * FROM ticket_positions")
    cursor.execute("DROP TABLE ticket_positions")

    table = Table('ticket_positions', key=('ticket', 'position'))[
        Column('ticket', type='int'),
        Column('position', type='int'),
        Index(['ticket', 'position'], unique=True),
    ],

    db_connector, _ = DatabaseManager(env).get_connector()
    for stmt in db_connector.to_sql(table):
        cursor.execute(stmt)

    cursor.execute("INSERT INTO ticket_positions (ticket, position) "
                   "SELECT ticket, position FROM ticket_positions_old")
    cursor.execute("DROP TABLE ticket_positions_old")
