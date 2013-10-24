from trac.db import Table, Column, Index, DatabaseManager

def do_upgrade(env, ver, cursor):
    """Add a ticket position history table
    """

    table = Table('ticket_positions_change', key=('ticket', 'time'))[
        Column('ticket', type='int'),
        Column('time', type='int64'),
        Column('author'),
        Column('oldposition'),
        Column('newposition'),
        Index(['ticket']),
        Index(['time']),
    ]

    db_connector, _ = DatabaseManager(env).get_connector()
    for stmt in db_connector.to_sql(table):
        cursor.execute(stmt)
