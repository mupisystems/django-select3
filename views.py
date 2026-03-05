from __future__ import annotations

import json

from django import forms
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

from .widgets import (
    Select3ComboboxAjaxWidget,
    Select3ComboboxWidget,
    Select3MultiSelectAjaxWidget,
    Select3MultiSelectWidget,
)


class _Select3DemoForm(forms.Form):
    status = forms.ChoiceField(
        required=False,
        choices=[("A", "Ativo"), ("I", "Inativo"), ("B", "Bloqueado")],
        widget=Select3ComboboxWidget(
            label="Status (static single)",
            placeholder="Selecione uma opção",
            allow_clear=True,
        ),
    )

    status_big = forms.CharField(
        required=False,
        widget=Select3ComboboxWidget(
            label="Status (static single via options_element_id)",
            placeholder="Selecione (options_element_id)",
            allow_clear=True,
            options_element_id="select3_demo_status_big_options",
        ),
    )

    country = forms.CharField(
        required=False,
        widget=Select3ComboboxAjaxWidget(
            label="País (AJAX single)",
            ajax_url="select3:mock_countries",
            placeholder="Busque um país...",
            allow_clear=True,
            min_search_length=0,
            initial_label="",
        ),
    )

    state = forms.CharField(
        required=False,
        widget=Select3ComboboxAjaxWidget(
            label="Estado (AJAX single com forward)",
            ajax_url="select3:mock_states",
            placeholder="Busque um estado...",
            allow_clear=True,
            min_search_length=0,
            forward={"country": "country"},
            initial_label="",
        ),
    )

    city = forms.CharField(
        required=False,
        widget=Select3ComboboxAjaxWidget(
            label="Cidade (AJAX single com forward)",
            ajax_url="select3:mock_cities",
            placeholder="Busque uma cidade...",
            allow_clear=True,
            min_search_length=2,
            forward={"state": "state"},
            initial_label="",
        ),
    )

    tags = forms.MultipleChoiceField(
        required=False,
        choices=[("vip", "VIP"), ("late", "Atraso"), ("new", "Novo")],
        widget=Select3MultiSelectWidget(
            label="Tags (static multi)",
            placeholder="Selecione...",
            allow_clear=True,
        ),
    )

    services = forms.MultipleChoiceField(
        required=False,
        widget=Select3MultiSelectAjaxWidget(
            label="Serviços (AJAX multi)",
            ajax_url="select3:mock_services",
            placeholder="Digite para buscar...",
            allow_clear=True,
            min_search_length=2,
            forward={"country": "country"},
        ),
    )

    cities_multi = forms.MultipleChoiceField(
        required=False,
        widget=Select3MultiSelectAjaxWidget(
            label="Cidades (AJAX multi com forward)",
            ajax_url="select3:mock_cities",
            placeholder="Digite para buscar cidades...",
            allow_clear=True,
            min_search_length=2,
            forward={"state": "state"},
        ),
    )


@login_required
def demo(request):
    form = _Select3DemoForm(request.POST or None)
    parsed = None
    if request.method == "POST" and form.is_valid():
        parsed = form.cleaned_data

    return render(
        request,
        "select3/demo.html",
        {
            "form": form,
            "parsed": parsed,
        },
    )


def _parse_forward(request) -> dict:
    raw = request.GET.get("forward")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _filter_by_q(results: list[dict], q: str) -> list[dict]:
    if not q:
        return results
    q_lower = q.strip().lower()
    if not q_lower:
        return results
    return [r for r in results if q_lower in (r.get("text", "").lower())]


def _paginate(request, results: list[dict]) -> tuple[list[dict], bool]:
    """Simple pagination helper for mock endpoints.

    Query params supported:
      - page (1-based)
      - page_size (optional; defaults to 20)
    Response contract includes: {results: [...], pagination: {more: bool}}
    """

    try:
        page = int(request.GET.get("page", "1") or "1")
    except Exception:
        page = 1
    if page < 1:
        page = 1

    try:
        page_size = int(request.GET.get("page_size", "20") or "20")
    except Exception:
        page_size = 20
    if page_size <= 0:
        page_size = 20

    start = (page - 1) * page_size
    end = start + page_size
    page_items = results[start:end]
    more = end < len(results)
    return page_items, more


def _get_pagination_params(request, *, default_page_size: int = 20, max_page_size: int = 100) -> tuple[int, int]:
    try:
        page = int(request.GET.get("page", "1") or "1")
    except Exception:
        page = 1
    if page < 1:
        page = 1

    try:
        page_size = int(request.GET.get("page_size", str(default_page_size)) or str(default_page_size))
    except Exception:
        page_size = default_page_size

    if page_size <= 0:
        page_size = default_page_size
    if max_page_size and page_size > max_page_size:
        page_size = max_page_size

    return page, page_size


def _select3_paginate(request, items: list[dict]) -> dict:
    """Paginação 'Django-first' para endpoints AJAX do Select3.

    - Usa `django.core.paginator.Paginator`.
    - Retorna `next_page` (derivado de `page_obj.has_next()`).
    - Não exige `pagination.more`.

    Payload retornado:
      {
        "results": [...],
        "page": <int>,
        "page_size": <int>,
        "next_page": <int|null>
      }
    """

    page, page_size = _get_pagination_params(request)
    paginator = Paginator(items, page_size)
    page_obj = paginator.get_page(page)
    next_page = page_obj.next_page_number() if page_obj.has_next() else None
    return {
        "results": list(page_obj.object_list),
        "page": page_obj.number,
        "page_size": page_size,
        "next_page": next_page,
    }


_MOCK_COUNTRIES: list[dict] = [
    {"id": "BR", "text": "Brasil"},
    {"id": "AR", "text": "Argentina"},
    {"id": "US", "text": "Estados Unidos"},
    {"id": "PT", "text": "Portugal"},
    {"id": "ES", "text": "Espanha"},
    {"id": "MX", "text": "México"},
    {"id": "CL", "text": "Chile"},
    {"id": "CO", "text": "Colômbia"},
    {"id": "FR", "text": "França"},
    {"id": "DE", "text": "Alemanha"},
]

_MOCK_STATES: list[dict] = [
    # BR
    {"id": "SP", "text": "São Paulo", "country": "BR"},
    {"id": "RJ", "text": "Rio de Janeiro", "country": "BR"},
    {"id": "MG", "text": "Minas Gerais", "country": "BR"},
    {"id": "BA", "text": "Bahia", "country": "BR"},
    {"id": "PR", "text": "Paraná", "country": "BR"},
    {"id": "SC", "text": "Santa Catarina", "country": "BR"},
    {"id": "RS", "text": "Rio Grande do Sul", "country": "BR"},
    {"id": "PE", "text": "Pernambuco", "country": "BR"},
    {"id": "CE", "text": "Ceará", "country": "BR"},
    {"id": "GO", "text": "Goiás", "country": "BR"},
    # AR
    {"id": "B", "text": "Buenos Aires", "country": "AR"},
    {"id": "C", "text": "Córdoba", "country": "AR"},
    {"id": "SF", "text": "Santa Fe", "country": "AR"},
    {"id": "MZA", "text": "Mendoza", "country": "AR"},
    # US
    {"id": "CA", "text": "California", "country": "US"},
    {"id": "NY", "text": "New York", "country": "US"},
    {"id": "TX", "text": "Texas", "country": "US"},
    {"id": "FL", "text": "Florida", "country": "US"},
    {"id": "WA", "text": "Washington", "country": "US"},
    {"id": "IL", "text": "Illinois", "country": "US"},
    # PT
    {"id": "LX", "text": "Lisboa", "country": "PT"},
    {"id": "PRT", "text": "Porto", "country": "PT"},
    {"id": "BRG", "text": "Braga", "country": "PT"},
    {"id": "CBA", "text": "Coimbra", "country": "PT"},
    # ES
    {"id": "MD", "text": "Madrid", "country": "ES"},
    {"id": "CT", "text": "Cataluña", "country": "ES"},
    {"id": "AND", "text": "Andalucía", "country": "ES"},
    # MX
    {"id": "CMX", "text": "Ciudad de México", "country": "MX"},
    {"id": "JAL", "text": "Jalisco", "country": "MX"},
    {"id": "NLE", "text": "Nuevo León", "country": "MX"},
    # CL
    {"id": "RM", "text": "Región Metropolitana", "country": "CL"},
    {"id": "VS", "text": "Valparaíso", "country": "CL"},
    # CO
    {"id": "BOG", "text": "Bogotá D.C.", "country": "CO"},
    {"id": "ANT", "text": "Antioquia", "country": "CO"},
    # FR
    {"id": "IDF", "text": "Île-de-France", "country": "FR"},
    {"id": "NAQ", "text": "Nouvelle-Aquitaine", "country": "FR"},
    # DE
    {"id": "BE", "text": "Berlin", "country": "DE"},
    {"id": "BY", "text": "Bayern", "country": "DE"},
]


def _build_mock_cities() -> list[dict]:
    # Seed a few realistic ones for nicer demo/search.
    base: list[dict] = [
        {"id": "3550308", "text": "São Paulo", "state": "SP"},
        {"id": "3548708", "text": "Santos", "state": "SP"},
        {"id": "3304557", "text": "Rio de Janeiro", "state": "RJ"},
        {"id": "3106200", "text": "Belo Horizonte", "state": "MG"},
        {"id": "2927408", "text": "Salvador", "state": "BA"},
        {"id": "2000", "text": "La Plata", "state": "B"},
        {"id": "2001", "text": "Mar del Plata", "state": "B"},
        {"id": "3000", "text": "Córdoba", "state": "C"},
        {"id": "4000", "text": "Los Angeles", "state": "CA"},
        {"id": "4001", "text": "San Francisco", "state": "CA"},
        {"id": "5000", "text": "New York City", "state": "NY"},
        {"id": "6000", "text": "Lisboa", "state": "LX"},
        {"id": "6001", "text": "Cascais", "state": "LX"},
        {"id": "7000", "text": "Porto", "state": "PRT"},
    ]

    # Generate enough data to test pagination/infinite scroll.
    # Deterministic IDs (string) + searchable labels.
    states = [s["id"] for s in _MOCK_STATES]
    for st in states:
        for i in range(1, 31):
            cid = f"{st}-{i:03d}"
            base.append({"id": cid, "text": f"Cidade {i:02d} - {st}", "state": st})
    return base


_MOCK_CITIES: list[dict] = _build_mock_cities()


def _build_mock_services() -> list[dict]:
    # Icons must exist in select3/static/select3/select3-widgets.js ICONS map.
    icons = ["scissors", "user", "sparkles", "spa", "stethoscope", "message", "truck"]
    colors = [
        ("#2563eb", "#ffffff"),
        ("#111827", "#ffffff"),
        ("#db2777", "#ffffff"),
        ("#16a34a", "#ffffff"),
        ("#0ea5e9", "#ffffff"),
        ("#7c3aed", "#ffffff"),
        ("#f59e0b", "#111827"),
    ]

    # Keep a few named items, then generate a larger list.
    base: list[dict] = [
        {"id": "haircut", "text": "Corte de cabelo", "country": "BR", "icon": "scissors", "color": "#2563eb", "textColor": "#ffffff"},
        {"id": "beard", "text": "Barba", "country": "BR", "icon": "user", "color": "#111827", "textColor": "#ffffff"},
        {"id": "nails", "text": "Manicure", "country": "BR", "icon": "sparkles", "color": "#db2777", "textColor": "#ffffff"},
        {"id": "massage", "text": "Massagem", "country": "BR", "icon": "spa", "color": "#16a34a", "textColor": "#ffffff"},
        {"id": "consult", "text": "Consulta", "country": "PT", "icon": "stethoscope", "color": "#0ea5e9", "textColor": "#ffffff"},
        {"id": "therapy", "text": "Terapia", "country": "PT", "icon": "message", "color": "#7c3aed", "textColor": "#ffffff"},
        {"id": "delivery", "text": "Entrega", "country": "US", "icon": "truck", "color": "#f59e0b", "textColor": "#111827"},
    ]

    for country in [c["id"] for c in _MOCK_COUNTRIES]:
        for i in range(1, 41):
            icon = icons[(i - 1) % len(icons)]
            color, text_color = colors[(i - 1) % len(colors)]
            base.append(
                {
                    "id": f"{country.lower()}-service-{i:02d}",
                    "text": f"Serviço {i:02d} ({country})",
                    "country": country,
                    "icon": icon,
                    "color": color,
                    "textColor": text_color,
                }
            )
    return base


_MOCK_SERVICES: list[dict] = _build_mock_services()


@login_required
def mock_countries(request):
    q = request.GET.get("q", "")
    results = _filter_by_q(_MOCK_COUNTRIES, q)
    page_items, more = _paginate(request, results)
    return JsonResponse({"results": page_items, "pagination": {"more": more}})


@login_required
def mock_states(request):
    q = request.GET.get("q", "")
    forward = _parse_forward(request)
    country = str(forward.get("country") or "")

    states = [
        {"id": s["id"], "text": s["text"]}
        for s in _MOCK_STATES
        if (not country or s.get("country") == country)
    ]
    states = _filter_by_q(states, q)
    page_items, more = _paginate(request, states)
    return JsonResponse({"results": page_items, "pagination": {"more": more}})


@login_required
def mock_cities(request):
    q = request.GET.get("q", "")
    forward = _parse_forward(request)
    state = str(forward.get("state") or "")

    cities = [
        {"id": c["id"], "text": c["text"]}
        for c in _MOCK_CITIES
        if (not state or c.get("state") == state)
    ]
    cities = _filter_by_q(cities, q)
    page_items, more = _paginate(request, cities)
    return JsonResponse({"results": page_items, "pagination": {"more": more}})


@login_required
def mock_services(request):
    q = request.GET.get("q", "")
    forward = _parse_forward(request)
    country = str(forward.get("country") or "")

    services = [s for s in _MOCK_SERVICES if (not country or s.get("country") == country)]
    services = _filter_by_q(services, q)
    page_items, more = _paginate(request, services)
    return JsonResponse({"results": page_items, "pagination": {"more": more}})


@login_required
@require_GET
def mock_services_paginator(request):
    """Exemplo de endpoint 'correto' usando `Paginator`.

    Esse é o modelo recomendado para endpoints reais:

    - Filtra por `q`
    - Aplica `forward` quando necessário
    - Pagina com `Paginator`
    - Retorna `next_page` (e opcionalmente `page_size`)

    O JS do Select3 suporta também `pagination.more`, mas aqui mostramos a forma
    mais simples (Django-first) sem obrigar esse campo.
    """

    q = request.GET.get("q", "")
    forward = _parse_forward(request)
    country = str(forward.get("country") or "")

    services = [s for s in _MOCK_SERVICES if (not country or s.get("country") == country)]
    services = _filter_by_q(services, q)
    payload = _select3_paginate(request, services)
    return JsonResponse(payload)
