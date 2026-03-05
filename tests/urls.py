from __future__ import annotations

from django.http import JsonResponse
from django.urls import include, path


def _dummy_autocomplete(request):
    # Only used to let widgets reverse named URLs in tests.
    return JsonResponse({"results": []})


_autocomplete_patterns = [
    path("cities", _dummy_autocomplete, name="cities"),
    path("services", _dummy_autocomplete, name="services"),
]

urlpatterns = [
    path("autocomplete/", include((_autocomplete_patterns, "autocomplete"), namespace="autocomplete")),
]
