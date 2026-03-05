from django.urls import path

from . import views

app_name = "select3"

urlpatterns = [
    path("demo/", views.demo, name="demo"),
    path("mock/countries/", views.mock_countries, name="mock_countries"),
    path("mock/states/", views.mock_states, name="mock_states"),
    path("mock/cities/", views.mock_cities, name="mock_cities"),
    path("mock/services/", views.mock_services, name="mock_services"),
    path("mock/services-paginator/", views.mock_services_paginator, name="mock_services_paginator"),
]
