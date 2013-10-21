#!/usr/bin/env python
# -*- coding: utf-8 -*-
# Copyright (C) 2013 CGI IT UK Ltd

from setuptools import setup

setup(
    name='AgileToolsPlugin',
    version=0.1,
    description='Implements an Agile style task board and backlog manager',
    author="Ian Clark",
    author_email="ian.clark@cgi.com",
    license='BSD',
    url='http://define.primeportal.com/',
    packages=['agiletools'],
    package_data={
        'agiletools': [
            'htdocs/css/*.css',
            'htdocs/js/*.js',
            'templates/*',
        ]
    },
    entry_points={
        'trac.plugins': [
            'agiletools.taskboard = agiletools.taskboard',
            'agiletools.api    = agiletools.api',
        ]
    },
)
