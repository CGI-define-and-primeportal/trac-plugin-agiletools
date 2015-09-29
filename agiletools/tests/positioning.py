import unittest
import random
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
        self.env = EnvironmentStub(enable=['trac.*', 'agiletools.*', 'tracremoteticket.api.*'], default_data=True)
        self.ts = AgileToolsSystem(self.env)
        self.ts.environment_created()
        self.req = Mock(href=self.env.href, authname='anonymous')

    def test_fundmentals(self):
        Ticket(self.env).insert()
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [1])

    def test_original_ordering(self):
        ticket_priorities = ["minor", "major", "blocker", "critical", "minor"]
        for priority in ticket_priorities:
            ticket = Ticket(self.env)
            ticket["priority"] = priority
            ticket.insert()

        # Test that without an order set, and without any explicit positions
        # our tickets are ordered by priority DESC, id ASC as before
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [3,4,2,1,5])

        # Test that when an explicit order and asc/desc set, continues to work
        # as before
        self.assertEqual([r['id'] for r in Query(self.env, order='id', desc=1).execute(self.req)],
                         [5,4,3,2,1])

    def test_manual_move(self):
        for i in range(3):
            Ticket(self.env).insert()

        self.ts.move(1,0)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [1,2,3])

        # Unique case which again shouldn't change anything
        # If we moved the ticket to index 1 then 0 would be empty
        # and we would have a gap. There's no need to do anything
        self.ts.move(1,1)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [1,2,3])

        self.assertEqual(0, self.ts.position(1))

        self.ts.move(2,0)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [2,1,3])

        # Three doesn't have a position yet
        self.ts.move(2,3)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [1,2,3])


    def test_relative_move(self):

        tickets = 6
        for i in range(tickets):
            Ticket(self.env).insert()

        # Move before
        self.ts.move(4, self.ts.position(1, generate=True))
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [4,1,2,3,5,6])

        self.ts.move(4, self.ts.position(3, generate=True))
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [1,2,4,3,5,6])

        self.ts.move(1, self.ts.position(6, generate=True))
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [2,4,3,5,1,6])

        self.ts.move(6, self.ts.position(4, generate=True))
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [2,6,4,3,5,1])

        # Move after
        self.ts.move(2, self.ts.position(1, generate=True) + 1)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [6,4,3,5,1,2])

        self.ts.move(4, self.ts.position(5, generate=True) + 1)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [6,3,5,4,1,2])

        self.ts.move(4, self.ts.position(1, generate=True) + 1)
        self.assertEqual([r['id'] for r in Query(self.env).execute(self.req)],
                         [6,3,5,1,4,2])

    def test_no_gaps(self):

        tickets = 100
        moves = 1000

        tickets_range = range(tickets)

        for i in tickets_range:
            Ticket(self.env).insert()

        random.seed(0)

        for j in xrange(moves):
            mover = random.randint(1,tickets)
            relative = random.randint(1,tickets)
            self.ts.move(mover, self.ts.position(relative, generate=True))

        final_positions = [self.ts.position(r['id']) for r in Query(self.env, max=tickets).execute(self.req)]

        self.ts.move(999,999)
        if None not in final_positions:
            self.assertEqual(final_positions, tickets_range)

# used if you run this not via setup.py test
def suite():
    suite = unittest.TestSuite()
    suite.addTest(unittest.makeSuite(PositioningTestCase, 'test'))
    return suite

if __name__ == '__main__':
    unittest.main(defaultTest="suite")
