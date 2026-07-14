"""Pytest bootstrap for the flat-layout `select3` app.

The Django app lives in the repository root directory (which is named
`select3`), so we put its *parent* on ``sys.path`` to make ``import select3``
resolve, then configure a minimal Django project for the tests.
"""
from __future__ import annotations

import os
import sys

import django
from django.conf import settings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARENT = os.path.dirname(ROOT)
if PARENT not in sys.path:
    sys.path.insert(0, PARENT)


def pytest_configure():
    settings.configure(
        DEBUG=True,
        SECRET_KEY="select3-test-secret",
        ROOT_URLCONF="tests.urls",
        INSTALLED_APPS=[
            "django.contrib.contenttypes",
            "django.contrib.auth",
            "select3",
        ],
        DATABASES={
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"},
        },
        TEMPLATES=[
            {
                "BACKEND": "django.template.backends.django.DjangoTemplates",
                "DIRS": [],
                "APP_DIRS": True,
                "OPTIONS": {},
            }
        ],
        STATIC_URL="/static/",
        USE_I18N=True,
        USE_TZ=True,
        DEFAULT_AUTO_FIELD="django.db.models.BigAutoField",
    )
    django.setup()
