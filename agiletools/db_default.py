from trac.db.schema import Table, Column, Index

old_name = 'taskboard_schema'
name = 'agiletools_version'
version = 2

schema = [
    Table('ticket_positions')[
        Column('grouping'),
        Column('position', type='int'),
        Column('ticket', type='int'),
    ],
]