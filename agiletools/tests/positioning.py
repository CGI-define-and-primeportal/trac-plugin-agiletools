import unittest
from trac.core import Component, implements
from trac.test import EnvironmentStub, Mock

from agiletools.api import AgileToolsSystem

from trac.ticket.query import Query
from trac.ticket.model import Ticket

class PositioningTestCase(unittest.TestCase):
    def _dump_positions(self):
        db = self.env.get_read_db()
        cursor = db.cursor()
        print "Dumping"
        print "%8s %8s" % ("position","ticket")
        for row in cursor.execute("SELECT position, ticket from ticket_positions order by position").fetchall():
            print "%8s %8s" % (row[1], row[2])

    def setUp(self):
        self.env = EnvironmentStub(enable=['trac.*', 'agiletools.*', 'tracremoteticket.api.*'])
        self.ts = AgileToolsSystem(self.env)
        self.ts.environment_created()
        self.req = Mock(href=self.env.href, authname='anonymous')

    def test_fundmentals(self):
        Ticket(self.env).insert()
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [1])

    def test_original_ordering(self):
        for i in range(5):
            Ticket(self.env).insert()
        self.assertEqual([r['id'] for r in Query(self.env, order='id', desc=1).execute(self.req)],
                         [5,4,3,2,1])

    def test_positioning(self):
        for i in range(3):
            Ticket(self.env).insert()

        self.ts.insert_before(1,2)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [1,2,3])

        self.ts.insert_before(2,1)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [2,1,3])

        self.ts.insert_before(3,2)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [3,2,1])

        self.ts.insert_before(1,2)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [3,1,2])

        self.ts.insert_before(2,1)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [3,2,1])

    def test_inserting_into_middle_of_default(self):
        for i in range(6):
            Ticket(self.env).insert()

        self.ts.insert_before(4,2)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [1,4,2,3,5,6])

        self.ts.insert_before(4,3)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [1,2,4,3,5,6])

        self.ts.insert_before(1,6)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [2,4,3,5,1,6])

        self.ts.insert_before(6,4)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [2,6,4,3,5,1])


# used if you run this not via setup.py test
def suite():
    suite = unittest.TestSuite()
    suite.addTest(unittest.makeSuite(PositioningTestCase, 'test'))
    return suite

if __name__ == '__main__':
    unittest.main(defaultTest="suite")
