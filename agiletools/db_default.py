from trac.db.schema import Table, Column, Index

old_name = 'taskboard_schema'
name = 'agiletools_version'
version = 4

schema = [
    Table('ticket_positions', key=('ticket', 'position'))[
        Column('ticket', type='int'),
        Column('position', type='int'),
        Index(['ticket', 'position'], unique=True),
    ],
    Table('ticket_positions_change', key=('ticket', 'time'))[
        Column('ticket', type='int'),
        Column('time', type='int64'),
        Column('author'),
        Column('oldposition'),
        Column('newposition'),
        Index(['ticket']),
        Index(['time']),
    ]
]