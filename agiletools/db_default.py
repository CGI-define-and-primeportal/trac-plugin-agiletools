from trac.db.schema import Table, Column, Index

old_name = 'taskboard_schema'
name = 'agiletools_version'
version = 3

schema = [
    Table('ticket_positions', key=('ticket', 'position'))[
        Column('ticket', type='int'),
        Column('position', type='int'),
        Index(['ticket', 'position'], unique=True),
    ], 
]