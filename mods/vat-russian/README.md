# Русский перевод Valheim Admin Tool

Клиентский мод-переводчик для панели **Valheim Admin Tool** (F7). Сам
оригинальный мод не изменяется и не распространяется: переводчик перехватывает
присваивание подписей `UnityEngine.UI.Text` и подставляет русские строки, а для
кириллицы выставляет системный шрифт.

- Открытие панели: **F7** (клавиша настраивается в оригинальном моде).
- Требуется установленный [Valheim Admin Tool 0.5.8](https://thunderstore.io/c/valheim/p/QoLTeam/Valheim_Admin_Tool/).
- Ставится в `BepInEx/plugins/ValheimRuVatTranslation/ValheimRuVatTranslation.dll`.
- Входит в архив для друзей `Valheim-Client-Mods-DragAndDrop.zip` из релизов.

## Сборка

```powershell
cd mods/vat-russian
dotnet build -c Release
# результат: bin/Release/netstandard2.1/ValheimRuVatTranslation.dll
```

Для сборки нужен .NET SDK и папка Valheim с BepInEx (путь задаётся
`-p:ValheimDir=...`, по умолчанию `D:\games\steam\steamapps\common\Valheim`).

## Устройство

- `TranslationPlugin.cs` — BepInEx-плагин и Harmony-патч на `Text.set_text`.
- `RussianStrings.cs` — словарь перевода (вкладки, кнопки, переключатели,
  сообщения и динамические префиксы) и кэш системных шрифтов.

Непереведённые редкие сообщения и подсказки остаются на английском — их можно
добавить в словарь `RussianStrings.Exact`.

## Лицензия

MIT (см. `LICENSE` в корне репозитория). Оригинальный Valheim Admin Tool имеет
собственных авторов и распространяется отдельно.
