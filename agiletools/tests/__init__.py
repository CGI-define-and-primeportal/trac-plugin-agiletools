import unittest

from agiletools.tests import positioning

def suite():
    suite = unittest.TestSuite()
    suite.addTest(positioning.suite())

    return suite

if __name__ == '__main__':
    unittest.main(defaultTest='suite')
