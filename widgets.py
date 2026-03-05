from __future__ import annotations

import json
from typing import Any, Iterable, Mapping, Optional

from django.conf import settings
from django.forms import Media
from django.forms.widgets import Widget
from django.http import QueryDict
from django.urls import NoReverseMatch, reverse
from django.utils.safestring import mark_safe


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _coerce_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    return bool(value)


def _normalize_initial(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple, set)):
        return "" if not value else str(next(iter(value)))
    return str(value)


def _flatten_choices(choices: Iterable[Any]) -> Iterable[tuple[Any, Any]]:
    """Flatten Django choices, tolerating optgroups.

    Django may provide choices like:
      [("1","One"), ("2","Two")]  (flat)
      [("Group", [("1","One"), ...]) , ...] (grouped)
    """
    for item in choices:
        if isinstance(item, (list, tuple)) and len(item) == 2 and isinstance(item[1], (list, tuple)):
            # potential optgroup: (group_label, group_choices)
            group_label, group_choices = item
            if all(isinstance(gc, (list, tuple)) and len(gc) == 2 for gc in group_choices):
                for value, label in group_choices:
                    yield value, label
                continue
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            yield item[0], item[1]


def _choices_to_option_dicts(choices: Iterable[Any]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for value, label in _flatten_choices(choices):
        result.append({"value": str(value), "label": str(label)})
    return result


def _normalize_multi_value(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    try:
        return [str(v) for v in value]
    except TypeError:
        return [str(value)]


def _resolve_ajax_url(ajax_url: str) -> str:
    if not ajax_url:
        return ""
    if "/" in ajax_url or ajax_url.startswith("http://") or ajax_url.startswith("https://"):
        return ajax_url
    try:
        return reverse(ajax_url)
    except NoReverseMatch:
        return ajax_url

class Select3BaseWidget(Widget):
    label: Optional[str] = None
    placeholder: Optional[str] = None
    allow_clear: bool = True
    required: Optional[bool] = None

    class Media:
        css = {
            "all": (
                "select3/select3-bundle.css",
            )
        }
        js = (
            "select3/select3-widgets.js",
        )

    @property
    def media(self):
        """Base Media + optional extra assets configured by the host app.

        Host apps can append extra CSS/JS (loaded after defaults) to override styling
        or extend behavior without forking the templates.

        Settings supported:
          - SELECT3_WIDGETS_EXTRA_CSS: iterable[str] (static paths)
          - SELECT3_WIDGETS_EXTRA_JS: iterable[str] (static paths)
        """

        bundle_css = getattr(settings, "SELECT3_WIDGETS_BUNDLE_CSS", None)
        if bundle_css:
            # Fully standalone mode: use a prebuilt bundle that already includes
            # Tailwind utilities + select3 core component styles.
            base = Media(css={"all": (str(bundle_css),)}, js=("select3/select3-widgets.js",))
        else:
            base = super().media

        extra_css = getattr(settings, "SELECT3_WIDGETS_EXTRA_CSS", None)
        extra_js = getattr(settings, "SELECT3_WIDGETS_EXTRA_JS", None)

        css_files = tuple(str(x) for x in (extra_css or ()) if x)
        js_files = tuple(str(x) for x in (extra_js or ()) if x)

        if not css_files and not js_files:
            return base

        extra = Media(css={"all": css_files} if css_files else {}, js=js_files)
        return base + extra

    def __init__(
        self,
        *,
        label: str | None = None,
        placeholder: str | None = None,
        allow_clear: bool = True,
        required: bool | None = None,
        attrs: Optional[Mapping[str, Any]] = None,
    ):
        super().__init__(attrs=attrs)
        self.label = label
        self.placeholder = placeholder
        self.allow_clear = allow_clear
        self.required = required

    def _is_required(self, field_required: bool) -> bool:
        if self.required is None:
            return bool(field_required)
        return bool(self.required)


class Select3ComboboxWidget(Select3BaseWidget):
    template_name = "select3/widgets/combobox.html"

    def __init__(
        self,
        *,
        label: str | None = None,
        placeholder: str | None = None,
        allow_clear: bool = True,
        required: bool | None = None,
        options_element_id: str | None = None,
        attrs: Optional[Mapping[str, Any]] = None,
    ):
        super().__init__(label=label, placeholder=placeholder, allow_clear=allow_clear, required=required, attrs=attrs)
        self.options_element_id = options_element_id

    def get_context(self, name: str, value: Any, attrs: Mapping[str, Any]):
        context = super().get_context(name, value, attrs)
        field_required = context.get("widget", {}).get("required", False)
        required = self._is_required(bool(field_required))

        options = _choices_to_option_dicts(getattr(self, "choices", []))
        options_json = _json_dumps(options)

        context["select3"] = {
            "name": name,
            "id": context["widget"]["attrs"].get("id", ""),
            "value": _normalize_initial(value),
            "label": self.label,
            "placeholder": self.placeholder or "Selecione uma opção",
            "options_json": mark_safe(options_json),
            "options_element_id": self.options_element_id or "",
            "allow_clear": _coerce_bool(self.allow_clear, True),
            "required": required,
        }
        return context


class Select3ComboboxAjaxWidget(Select3BaseWidget):
    template_name = "select3/widgets/combobox_ajax.html"

    def __init__(
        self,
        *,
        ajax_url: str,
        label: str | None = None,
        placeholder: str | None = None,
        allow_clear: bool = True,
        required: bool | None = None,
        min_search_length: int = 0,
        forward: Optional[Mapping[str, str]] = None,
        initial_label: str | None = None,
        attrs: Optional[Mapping[str, Any]] = None,
    ):
        super().__init__(label=label, placeholder=placeholder, allow_clear=allow_clear, required=required, attrs=attrs)
        self.ajax_url = ajax_url
        self.min_search_length = min_search_length
        self.forward = dict(forward) if forward else None
        self.initial_label = initial_label

    def get_context(self, name: str, value: Any, attrs: Mapping[str, Any]):
        context = super().get_context(name, value, attrs)
        field_required = context.get("widget", {}).get("required", False)
        required = self._is_required(bool(field_required))

        forward_json = _json_dumps(self.forward) if self.forward else ""

        context["select3"] = {
            "name": name,
            "id": context["widget"]["attrs"].get("id", ""),
            "value": _normalize_initial(value),
            "label": self.label,
            "placeholder": self.placeholder or "Busque...",
            "ajax_url": _resolve_ajax_url(self.ajax_url),
            "allow_clear": _coerce_bool(self.allow_clear, True),
            "required": required,
            "min_search_length": int(self.min_search_length or 0),
            "forward_json": forward_json,
            "initial_label": self.initial_label or "",
        }
        return context


class Select3MultiSelectWidget(Select3BaseWidget):
    template_name = "select3/widgets/multiselect.html"

    def value_from_datadict(self, data: Any, files: Any, name: str):
        if isinstance(data, QueryDict):
            return data.getlist(name)
        value = data.get(name)
        if value is None:
            return []
        if isinstance(value, (list, tuple)):
            return list(value)
        return [value]

    def get_context(self, name: str, value: Any, attrs: Mapping[str, Any]):
        context = super().get_context(name, value, attrs)
        field_required = context.get("widget", {}).get("required", False)
        required = self._is_required(bool(field_required))

        options = _choices_to_option_dicts(getattr(self, "choices", []))
        context["select3"] = {
            "name": name,
            "id": context["widget"]["attrs"].get("id", ""),
            "values": mark_safe(_json_dumps(_normalize_multi_value(value))),
            "label": self.label,
            "placeholder": self.placeholder or "Selecione...",
            "options_json": mark_safe(_json_dumps(options)),
            "allow_clear": _coerce_bool(self.allow_clear, True),
            "required": required,
        }
        return context


class Select3MultiSelectAjaxWidget(Select3BaseWidget):
    template_name = "select3/widgets/multiselect_ajax.html"

    def __init__(
        self,
        *,
        ajax_url: str,
        label: str | None = None,
        placeholder: str | None = None,
        allow_clear: bool = True,
        required: bool | None = None,
        min_search_length: int = 2,
        forward: Optional[Mapping[str, str]] = None,
        attrs: Optional[Mapping[str, Any]] = None,
    ):
        super().__init__(label=label, placeholder=placeholder, allow_clear=allow_clear, required=required, attrs=attrs)
        self.ajax_url = ajax_url
        self.min_search_length = min_search_length
        self.forward = dict(forward) if forward else None

    def value_from_datadict(self, data: Any, files: Any, name: str):
        if isinstance(data, QueryDict):
            return data.getlist(name)
        value = data.get(name)
        if value is None:
            return []
        if isinstance(value, (list, tuple)):
            return list(value)
        return [value]

    def get_context(self, name: str, value: Any, attrs: Mapping[str, Any]):
        context = super().get_context(name, value, attrs)
        field_required = context.get("widget", {}).get("required", False)
        required = self._is_required(bool(field_required))

        forward_json = _json_dumps(self.forward) if self.forward else ""

        context["select3"] = {
            "name": name,
            "id": context["widget"]["attrs"].get("id", ""),
            "values": mark_safe(_json_dumps(_normalize_multi_value(value))),
            "label": self.label,
            "placeholder": self.placeholder or "Digite para buscar...",
            "ajax_url": _resolve_ajax_url(self.ajax_url),
            "allow_clear": _coerce_bool(self.allow_clear, True),
            "required": required,
            "min_search_length": int(self.min_search_length if self.min_search_length is not None else 2),
            "forward_json": forward_json,
        }
        return context
