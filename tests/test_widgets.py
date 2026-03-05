from django import forms
from django.http import QueryDict
from django.test import SimpleTestCase, override_settings

from select3.widgets import (
    Select3ComboboxAjaxWidget,
    Select3ComboboxWidget,
    Select3MultiSelectAjaxWidget,
    Select3MultiSelectWidget,
)


class TestSelect3Widgets(SimpleTestCase):
    def test_multiselect_value_from_datadict_querydict_getlist(self):
        widget = Select3MultiSelectWidget()
        data = QueryDict("x=1&x=2&x=3")
        self.assertEqual(widget.value_from_datadict(data, None, "x"), ["1", "2", "3"])

    def test_multiselect_value_from_datadict_plain_dict(self):
        widget = Select3MultiSelectWidget()
        self.assertEqual(widget.value_from_datadict({"x": ["1", "2"]}, None, "x"), ["1", "2"])
        self.assertEqual(widget.value_from_datadict({"x": "1"}, None, "x"), ["1"])
        self.assertEqual(widget.value_from_datadict({}, None, "x"), [])

    @override_settings(ROOT_URLCONF="select3.tests.urls")
    def test_ajax_url_reverses_autocomplete_namespace(self):
        widget = Select3ComboboxAjaxWidget(ajax_url="autocomplete:cities")
        ctx = widget.get_context("city", "123", {"id": "id_city"})
        self.assertTrue(ctx["select3"]["ajax_url"].startswith("/autocomplete/"))
        self.assertTrue(ctx["select3"]["ajax_url"].endswith("cities"))

    def test_widget_render_contains_expected_contract_strings(self):
        class F(forms.Form):
            status = forms.ChoiceField(
                required=False,
                choices=[("A", "Ativo"), ("I", "Inativo")],
                widget=Select3ComboboxWidget(label="Status"),
            )
            city = forms.CharField(
                required=False,
                widget=Select3ComboboxAjaxWidget(
                    label="Cidade",
                    ajax_url="autocomplete:cities",
                    forward={"state": "state"},
                    min_search_length=2,
                    initial_label="São Paulo",
                ),
            )
            tags = forms.MultipleChoiceField(
                required=False,
                choices=[("1", "VIP"), ("2", "Atraso")],
                widget=Select3MultiSelectWidget(label="Tags"),
            )
            services = forms.MultipleChoiceField(
                required=False,
                widget=Select3MultiSelectAjaxWidget(
                    label="Serviços",
                    ajax_url="autocomplete:services",
                    min_search_length=2,
                ),
            )

        form = F()

        html_status = form["status"].as_widget()
        self.assertIn("combobox-wrapper", html_status)
        self.assertIn('data-select3="combobox"', html_status)
        self.assertNotIn("x-data=", html_status)

        html_city = form["city"].as_widget()
        self.assertIn("combobox-wrapper", html_city)
        self.assertIn('data-select3="combobox-ajax"', html_city)
        self.assertIn("data-ajax-url=", html_city)
        self.assertNotIn("x-data=", html_city)

        html_tags = form["tags"].as_widget()
        self.assertIn('data-select3="multiselect"', html_tags)
        self.assertIn('data-name="tags"', html_tags)
        self.assertNotIn("x-data=", html_tags)

        html_services = form["services"].as_widget()
        self.assertIn('data-select3="multiselect-ajax"', html_services)
        self.assertIn("data-ajax-url=", html_services)
        self.assertNotIn("x-data=", html_services)

    def test_multiselect_ajax_value_from_datadict_getlist(self):
        for widget in (Select3MultiSelectWidget(), Select3MultiSelectAjaxWidget(ajax_url="autocomplete:services")):
            with self.subTest(widget=widget.__class__.__name__):
                data = QueryDict("s=1&s=2")
                self.assertEqual(widget.value_from_datadict(data, None, "s"), ["1", "2"])
