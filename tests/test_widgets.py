from __future__ import annotations

from django import forms
from django.http import QueryDict

from django_select3.widgets import (
    Select3ComboboxAjaxWidget,
    Select3ComboboxWidget,
    Select3MultiSelectAjaxWidget,
    Select3MultiSelectWidget,
    _choices_to_option_dicts,
    _flatten_choices,
    _normalize_multi_value,
    _resolve_ajax_url,
)


# --------------------------------------------------------------------------- #
# Helper functions
# --------------------------------------------------------------------------- #

def test_flatten_choices_flat():
    choices = [("1", "One"), ("2", "Two")]
    assert list(_flatten_choices(choices)) == [("1", "One"), ("2", "Two")]


def test_flatten_choices_optgroups():
    choices = [
        ("Group A", [("1", "One"), ("2", "Two")]),
        ("Group B", [("3", "Three")]),
    ]
    assert list(_flatten_choices(choices)) == [
        ("1", "One"),
        ("2", "Two"),
        ("3", "Three"),
    ]


def test_choices_to_option_dicts_stringifies():
    assert _choices_to_option_dicts([(1, "One")]) == [{"value": "1", "label": "One"}]


def test_normalize_multi_value():
    assert _normalize_multi_value(None) == []
    assert _normalize_multi_value("a") == ["a"]
    assert _normalize_multi_value([1, 2]) == ["1", "2"]


def test_resolve_ajax_url_variants():
    assert _resolve_ajax_url("/api/x/") == "/api/x/"
    assert _resolve_ajax_url("https://example.com/x") == "https://example.com/x"
    # Known URL name gets reversed.
    assert _resolve_ajax_url("dummy_autocomplete") == "/autocomplete/"
    # Unknown name is returned unchanged (NoReverseMatch fallback).
    assert _resolve_ajax_url("does_not_exist") == "does_not_exist"


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #

def _render(widget, name="field", value=None):
    return widget.render(name, value)


def test_combobox_renders_options_and_scoped_classes():
    widget = Select3ComboboxWidget()
    widget.choices = [("A", "Active"), ("I", "Inactive")]
    html = _render(widget, "status")
    assert 'data-select3="combobox"' in html
    assert "s3-wrapper" in html
    assert "Active" in html and "Inactive" in html
    # No leaked Tailwind utility classes.
    assert "text-gray-700" not in html
    assert "brand-primary" not in html


def test_combobox_ajax_resolves_url_by_name():
    widget = Select3ComboboxAjaxWidget(ajax_url="dummy_autocomplete")
    html = _render(widget, "city")
    assert 'data-ajax-url="/autocomplete/"' in html
    assert 'data-select3="combobox-ajax"' in html


def test_multiselect_renders_values():
    widget = Select3MultiSelectWidget()
    widget.choices = [("1", "VIP"), ("2", "Late")]
    html = _render(widget, "tags", ["1"])
    assert 'data-select3="multiselect"' in html
    assert "s3-badges" in html
    assert "VIP" in html


def test_multiselect_value_from_datadict_querydict():
    widget = Select3MultiSelectWidget()
    qd = QueryDict(mutable=True)
    qd.setlist("tags", ["1", "2"])
    assert widget.value_from_datadict(qd, {}, "tags") == ["1", "2"]


def test_multiselect_ajax_value_from_datadict_plain_dict():
    widget = Select3MultiSelectAjaxWidget(ajax_url="/api/x/")
    assert widget.value_from_datadict({"tags": ["1"]}, {}, "tags") == ["1"]
    assert widget.value_from_datadict({}, {}, "tags") == []


def test_required_forced_true_shows_asterisk():
    widget = Select3ComboboxWidget(label="Status", required=True)
    widget.choices = [("A", "Active")]
    html = _render(widget, "status")
    assert "s3-required" in html


def test_media_declares_assets():
    widget = Select3ComboboxWidget()
    media = str(widget.media)
    assert "select3/select3-bundle.css" in media
    assert "select3/select3-widgets.js" in media


def test_widget_in_form_renders():
    class ExampleForm(forms.Form):
        status = forms.ChoiceField(
            choices=[("A", "Active"), ("I", "Inactive")],
            required=False,
            widget=Select3ComboboxWidget(),
        )

    form = ExampleForm()
    html = str(form)
    assert 's3-wrapper' in html
    assert 'Active' in html
