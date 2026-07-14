"""Pytest bootstrap for the `django_select3` app.

The package lives in the ``django_select3/`` subfolder of the repository, so
``import django_select3`` works from the repository root regardless of the
checkout directory name. We add the repo root to ``sys.path`` as a fallback for
runs where the package is not installed.
"""
from __future__ import annotations

import os
import sys

import django
from django.conf import settings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    import django_select3  # noqa: F401
except ModuleNotFoundError:
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)


def pytest_configure():
    settings.configure(
        DEBUG=True,
        SECRET_KEY="select3-test-secret",
        ROOT_URLCONF="tests.urls",
        INSTALLED_APPS=[
            "django.contrib.contenttypes",
            "django.contrib.auth",
            "django_select3",
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
