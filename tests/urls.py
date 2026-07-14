from django.http import JsonResponse
from django.urls import path


def _dummy(request):
    return JsonResponse({"results": []})


urlpatterns = [
    path("autocomplete/", _dummy, name="dummy_autocomplete"),
]
