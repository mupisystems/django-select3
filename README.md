# select3

Widgets Django Forms para os componentes "Select3" — combobox e multiselect com busca AJAX, sem depender de Alpine.js.

Use Select3 em qualquer `forms.Form`/`forms.ModelForm` apenas trocando o `widget=...`.

O app registra CSS e JS próprios, inicializando via `data-select3`.

## O que vem pronto

Widgets disponíveis (4 variações):

- `Select3ComboboxWidget`: single + opções estáticas
- `Select3ComboboxAjaxWidget`: single + busca AJAX
- `Select3MultiSelectWidget`: multi + opções estáticas
- `Select3MultiSelectAjaxWidget`: multi + busca AJAX

Arquivos importantes:

- CSS (standalone): `select3/static/select3/select3-bundle.css`
- JS (standalone): `select3/static/select3/select3-widgets.js` (namespace `window.select3Widgets`)
- Templates: `select3/templates/select3/widgets/*.html`

## Instalação / ativação

### Instalando via pip

```bash
pip install select3
```

Adicione `select3` ao `INSTALLED_APPS` do seu projeto Django.

Durante o desenvolvimento local (a partir deste repo), instale em modo editável:

```bash
pip install -e .
```

## Implementação em um projeto Django

O Select3 é uma biblioteca de widgets, basta adicionar o app, usar os widgets no form e renderizar o `{{ form.media }}`.

Durante o desenvolvimento local (a partir deste repo), use instalação editável:

```bash
python -m pip install -e .
```

1) Garanta que `select3` esteja no `INSTALLED_APPS`.

2) Garanta que seu template renderize os assets dos widgets.

O jeito recomendado é usar o `{{ form.media }}` (ou `{{ form.media.css }}` e `{{ form.media.js }}`), porque os widgets declaram `Media`.

Exemplo (em um template qualquer onde o form aparece):

```django
<form method="post">
  {% csrf_token %}

  {{ form.media }}
  {{ form.as_p }}

  <button type="submit">Salvar</button>
</form>
```

### (Opcional) CSS/JS extra para sobrescrever

Por padrão, os widgets carregam:

- `select3/select3-bundle.css`
- `select3/select3-widgets.js`

Se você quiser sobrescrever estilos sem mexer no CSS padrão (ou adicionar JS extra), configure no seu `settings.py`:

```py
SELECT3_WIDGETS_EXTRA_CSS = (
  "css/select3-overrides.css",
)

SELECT3_WIDGETS_EXTRA_JS = (
  # "js/select3-overrides.js",
)
```

Esses arquivos são adicionados **depois** dos assets padrão no `{{ form.media }}`.

### Sobrescrever cores (tema)

O CSS do Select3 é themeável por CSS variables. A principal é `--select3-primary`.

Por padrão, ela é definida como:

- `--select3-primary: var(--color-primary, #3b82f6);`

Ou seja: você pode definir `--select3-primary` diretamente, ou (se preferir) definir `--color-primary` no seu design system.

Exemplo (crie `css/select3-overrides.css` e registre via `SELECT3_WIDGETS_EXTRA_CSS`):

```css
:root {
  --select3-primary: #16a34a;
  /* alternativa: --color-primary: #16a34a; */
}
```

Se quiser aplicar apenas em uma área da página (escopo), use um wrapper:

```css
.select3-scope {
  --select3-primary: #9333ea;
}
```

```django
<div class="select3-scope">
  {{ form.media }}
  {{ form.as_p }}
</div>
```

## Conteúdo dinâmico (HTMX / modais / swaps)

O JS dos widgets inicializa automaticamente qualquer elemento com `data-select3`:

- no carregamento da página (`DOMContentLoaded`)
- e também quando novos elementos são inseridos no DOM (via `MutationObserver`)

Ou seja: se você renderiza forms via HTMX (ou injeta HTML via modal), os widgets devem “subir” sem precisar de snippet extra.

### Opt-out do observer

Se você preferir controlar manualmente (por performance ou previsibilidade), desabilite o observer antes de carregar o JS:

```html
<script>
  window.select3WidgetsConfig = { observe: false };
</script>
```

E chame manualmente quando precisar:

```js
window.select3Widgets.initAll(containerElement)
```

### Cleanup (quando remover elementos)

O JS expõe helpers para limpar listeners e dropdowns criados no `document.body`:

```js
window.select3Widgets.destroy(el)       // um widget root
window.select3Widgets.destroyAll(scope) // scope/container
```

## Uso (exemplos)

Exemplo completo com as 4 variações:

```py
from django import forms

from select3.widgets import (
    Select3ComboboxAjaxWidget,
    Select3ComboboxWidget,
    Select3MultiSelectAjaxWidget,
    Select3MultiSelectWidget,
)


class ExampleForm(forms.Form):
    status = forms.ChoiceField(
        label="Status",
        choices=[("A", "Ativo"), ("I", "Inativo")],
        required=False,
        widget=Select3ComboboxWidget(
            placeholder="Selecione...",
            allow_clear=True,
        ),
    )

    state = forms.CharField(
        label="Estado",
        required=False,
        widget=Select3ComboboxAjaxWidget(
        ajax_url="myapp:states_autocomplete",  # ou "/api/states/"
            placeholder="Busque estado...",
            min_search_length=0,
            allow_clear=True,
            initial_label="",
        ),
    )

    city = forms.CharField(
        label="Cidade",
        required=False,
        widget=Select3ComboboxAjaxWidget(
        ajax_url="myapp:cities_autocomplete",  # ou "/api/cities/"
            placeholder="Busque cidade...",
            min_search_length=2,
            allow_clear=True,
            forward={"state": "state"},
            initial_label="",
        ),
    )

    tags = forms.MultipleChoiceField(
        label="Tags",
        choices=[("1", "VIP"), ("2", "Atraso")],
        required=False,
        widget=Select3MultiSelectWidget(
            placeholder="Selecione...",
            allow_clear=True,
        ),
    )

    services = forms.MultipleChoiceField(
        label="Serviços",
        required=False,
        widget=Select3MultiSelectAjaxWidget(
        ajax_url="myapp:services_autocomplete",  # ou "/api/services/"
            placeholder="Digite para buscar...",
            min_search_length=2,
            forward={"city": "city"},
        ),
    )
```

## “Cláusulas” (args) dos widgets

Esta seção documenta os argumentos suportados no construtor de cada widget (os “kwargs” que você passa no `widget=...`).

### Args comuns (todos os widgets)

- `label: str | None`
  - Controla o label exibido no próprio template do widget.
  - Se você já renderiza labels por fora (ou usa `{{ form.as_p }}`/`as_crispy_field`), pode deixar `None`.

- `placeholder: str | None`
  - Texto do placeholder visível no input.
  - Se omitido, cada widget usa um default (“Selecione…”, “Busque…”, etc.).

- `allow_clear: bool`
  - Mostra/esconde o botão de limpar (ícone de “x”).
  - Observação: hoje isso é puramente UX (front-end). Se o campo for obrigatório, considere `allow_clear=False`.

- `required: bool | None`
  - Se `None` (padrão): o widget herda `field.required`.
  - Se `True/False`: força o estado “obrigatório” no template (exibe asterisco).
  - Observação: isso não faz validação. A validação de obrigatório continua sendo do `Field`.

- `attrs: dict | None`
  - Atributos HTML padrão do Django Widget.
  - O `id` vindo de `attrs` (ou gerado pelo Django) é usado nos inputs/labels do widget.

### Select3ComboboxWidget (single + estático)

Construtor: `Select3ComboboxWidget(..., options_element_id=None)`

- `options_element_id: str | None`
  - Alternativa para passar as opções via um elemento no HTML.
  - Uso recomendado quando a lista de opções é grande, para evitar HTML com `data-options-json="..."` muito pesado/escapado.

Formato esperado no DOM:

```html
<script type="application/json" id="my_options">
  [{"value": "A", "label": "Ativo"}, {"value": "I", "label": "Inativo"}]
</script>
```

Depois, no widget:

```py
Select3ComboboxWidget(options_element_id="my_options")
```

### Select3ComboboxAjaxWidget (single + AJAX)

Construtor: `Select3ComboboxAjaxWidget(ajax_url=..., min_search_length=0, forward=None, initial_label=None)`

- `ajax_url: str` (obrigatório)
  - Pode ser:
    - um nome de URL (o widget tenta `reverse(ajax_url)`)
    - uma URL absoluta/relativa (quando contém `/` ou começa com `http://`/`https://`)

- `min_search_length: int` (padrão `0`)
  - `0` significa “carregar/mostrar dropdown mesmo sem digitar”.
  - `>0` significa “só buscar quando tiver pelo menos N caracteres”.
  - UX: quando `q` tem menos de N caracteres, o dropdown mostra a mensagem pedindo mais caracteres.

- `forward: dict[str, str] | None`
  - Mapa `{chave_no_forward: nome_do_input_no_form}`.
  - O JS lê o valor atual via `document.querySelector('input[name="<nome>"]')`.
  - Exemplo: `forward={"state": "state"}` envia `{ "state": <valor do input name=state> }`.

- `initial_label: str | None`
  - Usado para “modo edição”: quando existe um `value` inicial, você também precisa passar o texto (label) para exibir na UI.
  - Sem isso, o widget sabe o “id” (valor) mas não sabe o “text” (label) até você buscar.

### Select3MultiSelectWidget (multi + estático)

Construtor: `Select3MultiSelectWidget(...)`

Detalhe importante: o widget posta múltiplos valores repetindo inputs hidden com o mesmo `name`.
Por isso, ele implementa `value_from_datadict()` usando `QueryDict.getlist(name)`.

Isso significa que ele funciona bem com `MultipleChoiceField`, `ModelMultipleChoiceField`, etc.

### Select3MultiSelectAjaxWidget (multi + AJAX)

Construtor: `Select3MultiSelectAjaxWidget(ajax_url=..., min_search_length=2, forward=None)`

Args:

- `ajax_url: str` (obrigatório): mesmo comportamento do combobox AJAX.
- `min_search_length: int` (padrão `2`): mesma regra do combobox AJAX.
- `forward: dict[str, str] | None`: mesma regra do combobox AJAX.

## Contrato do endpoint AJAX

O JS envia requisições `GET` com estes parâmetros:

- `q`: string digitada
- `forward`: JSON url-encoded (opcional)

Resposta esperada (contrato JSON):

```json
{
  "results": [
    {"id": "BR", "text": "Brasil"}
  ],
  "pagination": {
    "more": false
  }
}
```

Paginação (opcional):

- `pagination.more: boolean`
- `next_page: number | null`
- `next: string | null` (URL pronta para a próxima página)

Se nenhum metadado de paginação vier, o JS usa um fallback por tamanho:

- Assume `page_size=20` (ou use `page_size` no JSON, se você retornar)
- Continua buscando enquanto cada página vier “cheia”
- Para quando `results` vier vazio ou com menos itens que o `page_size`

Esse fallback pode causar 1 request extra no final quando o total é múltiplo exato do `page_size`.

Campos extras (opcionais) por item também são aceitos hoje e podem ser usados no futuro: `color`, `icon`, `textColor`.

### Ícones (sem dependências externas)

O `select3-widgets.js` não depende de Lucide/Font Awesome. Em vez disso, ele suporta um conjunto pequeno de ícones SVG inline embutidos.

Para usar, retorne `icon` com uma destas chaves:

- `scissors`
- `user`
- `sparkles`
- `spa`
- `stethoscope`
- `message`
- `truck`

#### Registrar ícones customizados

Se você quiser outros ícones além dos embutidos, você pode registrar (ou sobrescrever) ícones via JS, sem depender de nenhum pack:

```html
<script>
  // Deve rodar antes de usar os widgets na página
  window.select3Widgets = window.select3Widgets || {};
  // Após carregar static/js/select3-widgets.js:
  window.select3Widgets.registerIcons({
    calendar: {
      viewBox: '0 0 24 24',
      paths: [
        'M8 2v3',
        'M16 2v3',
        'M3 9h18',
        'M5 5h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z'
      ]
    }
  });
</script>
```

E opcionalmente:

- `color`: cor usada no ícone (lista) e no badge (background)
- `textColor`: cor do texto do badge quando `color` é aplicado

Exemplo de view simples:

```py
from django.http import JsonResponse


def my_autocomplete(request):
    q = (request.GET.get("q") or "").strip()
    forward_raw = request.GET.get("forward") or ""
    # forward_raw é JSON (string); se precisar, faça json.loads(forward_raw)

    results = []
    if q:
        results = [
            {"id": "1", "text": f"Resultado para: {q}"},
        ]

    return JsonResponse({"results": results})
```

## Forward (dependências/cascata)

O `forward` existe para encadear selects (ex.: País → Estado → Cidade).

Como funciona:

- Você configura `forward={"state": "state"}` no widget “filho” (Cidade).
- O JS inclui `forward` na querystring.
- Seu endpoint usa isso para filtrar os resultados.

Limitação atual:

- Se o “pai” tiver múltiplos inputs com o mesmo `name` (caso comum de multi), o forward hoje tende a pegar apenas um valor (usa `querySelector`, não `querySelectorAll`).
