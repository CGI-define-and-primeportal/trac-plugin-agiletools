from trac.db import DatabaseManager

from tracremoteticket.db_default import schema

def do_upgrade(env, ver, cursor):
    """Change schema name from taskboard_schema to agiletools_version
    """
    cursor.execute('UPDATE system SET name=%s WHERE name=%s',
                  ("agiletools_version", "taskboard_schema"))
