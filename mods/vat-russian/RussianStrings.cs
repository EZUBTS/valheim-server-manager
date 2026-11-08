// Словарь русского перевода интерфейса Valheim Admin Tool (VAT).
// Строки собраны из DLL мода (UI-типы и enum AdminTab) и переведены вручную.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace ValheimRuVatTranslation
{
    internal static class RussianStrings
    {
        internal static bool LastWasTranslated;

        private static readonly Dictionary<int, Font> CyrillicFonts = new Dictionary<int, Font>();

        private static readonly Dictionary<string, string> Exact = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            // --- Вкладки (enum AdminTab отображается через ToString) ---
            ["Cheats"] = "Читы",
            ["Skills"] = "Навыки",
            ["Speeds"] = "Скорости",
            ["Time"] = "Время",
            ["Weather"] = "Погода",
            ["Tools"] = "Инструменты",
            ["Workbenches"] = "Верстаки",
            ["Inventory"] = "Инвентарь",
            ["Items"] = "Предметы",
            ["Creatures"] = "Существа",
            ["ESP"] = "ESP",
            ["About"] = "О моде",

            // --- Общие элементы ---
            ["Admin functions"] = "Админ-функции",
            ["Admin menu GUI is not available yet."] = "Интерфейс админ-меню ещё недоступен.",
            ["Amount"] = "Количество",
            ["Apply"] = "Применить",
            ["Apply globally"] = "Применить всем",
            ["Apply locally"] = "Применить локально",
            ["Apply size"] = "Применить размер",
            ["Back"] = "Назад",
            ["Ban player"] = "Забанить игрока",
            ["Boss powers"] = "Силы боссов",
            ["Bouncy Mode"] = "Режим прыгучести",
            ["Build Everywhere"] = "Стройка везде",
            ["Cancel"] = "Отмена",
            ["Cheats cannot be saved without VAT access."] = "Нельзя сохранить читы без доступа к VAT.",
            ["Choose a weather preset"] = "Выберите погоду",
            ["Choose the number of rows"] = "Выберите число рядов",
            ["Clear"] = "Очистить",
            ["closed"] = "закрыто",
            ["Copied!"] = "Скопировано!",
            ["Copies all captured messages."] = "Копирует все записанные сообщения.",
            ["Copy"] = "Копировать",
            ["Copy to clipboard"] = "Скопировать в буфер",
            ["Could not copy to clipboard. Try again."] = "Не удалось скопировать. Попробуйте ещё раз.",
            ["Could not remove temporary cheat settings: "] = "Не удалось удалить временные настройки читов: ",
            ["Could not resize inventory. See Open log messages for details."] = "Не удалось изменить инвентарь. Подробности — в логе.",
            ["Could not save hotkey defaults: "] = "Не удалось сохранить горячие клавиши: ",
            ["Custom carry limit reset to normal game behavior."] = "Пользовательский лимит веса сброшен.",
            ["Death"] = "Смерть",
            ["Debug Mode"] = "Режим отладки",
            ["Default"] = "По умолчанию",
            ["Disable Durability Loss"] = "Без потери прочности",
            ["Disable Food Degradation"] = "Еда не портится",
            ["Disable Food Loss"] = "Не терять еду при смерти",
            ["Disable Item Loss"] = "Не терять предметы при смерти",
            ["Disable Skill Loss"] = "Не терять навыки при смерти",
            ["Disable Status Loss"] = "Не терять эффекты при смерти",
            ["Dropped Items"] = "Выпавшие предметы",
            ["Dungeons"] = "Подземелья",
            ["Escape is reserved for cancelling. Choose another key."] = "Escape зарезервирован для отмены. Выберите другую клавишу.",
            ["Example: 450"] = "Пример: 450",
            ["Explore Map"] = "Открыть карту",
            ["Failed"] = "Ошибка",
            ["Fly Mode"] = "Полёт",
            ["Forge: Always Succeed"] = "Кузница: всегда успех",
            ["FreeCam Mode"] = "Свободная камера",
            ["Freeze time (when applied)"] = "Заморозить время",
            ["Freeze weather (when applied)"] = "Заморозить погоду",
            ["Fun"] = "Развлечения",
            ["Ghost Mode"] = "Режим призрака",
            ["Giant / Tiny"] = "Гигант / карлик",
            ["Give 1H Rested"] = "Дать отдых на 1 час",
            ["God Mode"] = "Бессмертие",
            ["Hotkey action failed. Open log messages for details."] = "Действие не удалось. Подробности в логе.",
            ["Hotkeys"] = "Горячие клавиши",
            ["Infinite Jumps"] = "Бесконечные прыжки",
            ["Instant Crafting"] = "Мгновенный крафт",
            ["Invalid saved carry weight; keeping the current setting."] = "Некорректный сохранённый вес; оставлено текущее значение.",
            ["Invalid saved inventory rows; keeping the character's current size."] = "Некорректный размер инвентаря; оставлен текущий.",
            ["Inventory compatibility unavailable: "] = "Совместимость инвентаря недоступна: ",
            ["Inventory controls require a ready local character."] = "Управление инвентарём требует загруженного персонажа.",
            ["Inventory size"] = "Размер инвентаря",
            ["Invisible to players"] = "Невидим для игроков",
            ["Item"] = "Предмет",
            ["Jump power percentage; 100 is normal."] = "Сила прыжка в %; 100 — норма.",
            ["Kick player"] = "Кикнуть игрока",
            ["Local weather"] = "Локальная погода",
            ["Main key"] = "Основная клавиша",
            ["Map Teleport"] = "Телепорт по карте",
            ["Max distance"] = "Макс. дистанция",
            ["Maximum carry weight"] = "Максимальный вес",
            ["Message copied."] = "Сообщение скопировано.",
            ["Midnight"] = "Полночь",
            ["Moon Gravity"] = "Лунная гравитация",
            ["Mouse 1 (left)"] = "Мышь 1 (левая)",
            ["Mouse 2 (right)"] = "Мышь 2 (правая)",
            ["Mouse 3 (middle)"] = "Мышь 3 (средняя)",
            ["Mouse 4"] = "Мышь 4",
            ["Mouse 5"] = "Мышь 5",
            ["Mouse 6"] = "Мышь 6",
            ["Mouse 7"] = "Мышь 7",
            ["Nature (nearby)"] = "Природа (рядом)",
            ["Newer"] = "Новее",
            ["No Build Cost"] = "Бесплатная стройка",
            ["No Carry Limit"] = "Без лимита веса",
            ["No crafting stations available yet."] = "Верстаки пока недоступны.",
            ["No creature selected"] = "Существо не выбрано",
            ["No item selected"] = "Предмет не выбран",
            ["No matching creatures"] = "Существа не найдены",
            ["No matching items"] = "Предметы не найдены",
            ["No messages recorded yet."] = "Сообщений пока нет.",
            ["No messages to copy."] = "Нечего копировать.",
            ["No players online"] = "Игроков онлайн нет",
            ["No Structural Damage"] = "Постройки не разрушаются",
            ["NoClip Mode"] = "Режим NoClip",
            ["Noon"] = "Полдень",
            ["Not upgradeable"] = "Не улучшается",
            ["Older"] = "Старее",
            ["Only me"] = "Только я",
            ["Open / close menu"] = "Открыть / закрыть меню",
            ["Open log messages"] = "Открыть лог",
            ["Open workbench"] = "Открыть верстак",
            ["opened"] = "открыто",
            ["Other"] = "Другое",
            ["Party Hits"] = "Удары с конфетти",
            ["Pickables"] = "Собираемое",
            ["Pickup Radius"] = "Радиус подбора",
            ["Player"] = "Игрок",
            ["Player size percentage; 100 is normal."] = "Размер игрока в %; 100 — норма.",
            ["Players"] = "Игроки",
            ["Press a key, optionally with modifiers. Escape cancels."] = "Нажмите клавишу (можно с модификатором). Escape — отмена.",
            ["Quality"] = "Качество",
            ["Quick Heal"] = "Быстрое лечение",
            ["Radius"] = "Радиус",
            ["Record keys"] = "Записать клавиши",
            ["Recorded. Review the combination, then Save."] = "Записано. Проверьте сочетание и сохраните.",
            ["Recording cancelled."] = "Запись отменена.",
            ["Refresh"] = "Обновить",
            ["Regenerate nature"] = "Восстановить природу",
            ["regular"] = "обычный",
            ["Release the recording button/key first..."] = "Сначала отпустите кнопку/клавишу...",
            ["Reload configuration"] = "Перезагрузить конфигурацию",
            ["Remove Drops"] = "Убрать дроп",
            ["Reset"] = "Сбросить",
            ["Reset all to 100%"] = "Сбросить всё до 100%",
            ["Reset dungeons"] = "Сбросить подземелья",
            ["Reset follows the world clock again."] = "Время снова идёт по мировым часам.",
            ["Reset Map"] = "Сбросить карту",
            ["Reset resources"] = "Сбросить ресурсы",
            ["Reset resources (nearby)"] = "Сбросить ресурсы (рядом)",
            ["Reset terrain"] = "Сбросить рельеф",
            ["Reset time"] = "Сбросить время",
            ["Reset to 4 rows"] = "Вернуть 4 ряда",
            ["Reset weather"] = "Сбросить погоду",
            ["Resources"] = "Ресурсы",
            ["Resume global time"] = "Возобновить глобальное время",
            ["Rows"] = "Ряды",
            ["Save"] = "Сохранить",
            ["Save cheats"] = "Сохранить читы",
            ["Saved cheat settings loaded for the current session."] = "Сохранённые читы загружены.",
            ["Saved inventory size was not restored."] = "Сохранённый размер инвентаря не восстановлен.",
            ["Search all categories..."] = "Поиск по всем категориям...",
            ["Search names or prefab IDs..."] = "Поиск по названию или prefab ID...",
            ["Select an item"] = "Выберите предмет",
            ["Ship"] = "Корабль",
            ["Shift + left-click on the large map"] = "Shift + ЛКМ на большой карте",
            ["Show all ammunition."] = "Показать все стрелы и болты.",
            ["Show all armor pieces."] = "Показать всю броню.",
            ["Show all bows and crossbows."] = "Показать луки и арбалеты.",
            ["Show all crafting materials."] = "Показать материалы.",
            ["Show all food and consumables."] = "Показать еду и напитки.",
            ["Show all melee weapons."] = "Показать оружие ближнего боя.",
            ["Show all shields."] = "Показать щиты.",
            ["Show all tools."] = "Показать инструменты.",
            ["Show all trophies."] = "Показать трофеи.",
            ["Show every registered creature."] = "Показать всех существ.",
            ["Show miscellaneous, customization and unclassified items."] = "Показать прочие предметы.",
            ["Show version"] = "Показать версию",
            ["Show World Seed"] = "Показать сид мира",
            ["Spawn creature"] = "Создать существо",
            ["Spawn in inventory"] = "Выдать в инвентарь",
            ["Spawn in world"] = "Создать в мире",
            ["Spawn protection"] = "Защита базы",
            ["Speed hack"] = "Ускорение",
            ["Stars"] = "Звёзды",
            ["Station level"] = "Уровень станции",
            ["Stop recording"] = "Остановить запись",
            ["Sunrise"] = "Рассвет",
            ["Sunset"] = "Закат",
            ["Super Jump"] = "Супер-прыжок",
            ["Super Knockback"] = "Супер-отбрасывание",
            ["Tamed"] = "Приручённый",
            ["Teleport player to me"] = "Телепортировать игрока ко мне",
            ["Teleport to player"] = "Телепорт к игроку",
            ["The Elder"] = "Старейшина",
            ["The menu needs a shortcut so you can reopen these settings."] = "Меню нужна горячая клавиша, чтобы открыть настройки снова.",
            ["The Queen"] = "Королева",
            ["This key is not supported."] = "Эта клавиша не поддерживается.",
            ["Time of day"] = "Время суток",
            ["Toggle"] = "Переключить",
            ["Unassigned"] = "Не назначено",
            ["Unknown hotkey."] = "Неизвестная клавиша.",
            ["Unlimited Eitr"] = "Бесконечный эйтр",
            ["Unlimited Stamina"] = "Бесконечная выносливость",
            ["Unrestricted Portals"] = "Порталы без ограничений",
            ["Unsupported saved-cheat format."] = "Неподдерживаемый формат сохранённых читов.",
            ["Virtual Workbenches"] = "Виртуальные верстаки",
            ["Ward override"] = "Обход вардов",
            ["Wind in back"] = "Попутный ветер",
            ["Workbench"] = "Верстак",
            ["World"] = "Мир",
            ["Yagluth"] = "Яглут",

            // --- Боссы и биомы ---
            ["Eikthyr"] = "Эйктюр",
            ["Bonemass"] = "Костяная масса",
            ["Moder"] = "Модер",
            ["Fader"] = "Фейдер",
            ["Black Forest"] = "Чёрный лес",
            ["Deep North"] = "Крайний Север",
            ["Meadows"] = "Луга",
            ["Swamp"] = "Болото",
            ["Mountain"] = "Горы",
            ["Plains"] = "Равнины",
            ["Mistlands"] = "Туманные земли",
            ["Ashlands"] = "Пепельные земли",
            ["Ocean"] = "Океан",
            ["ALL"] = "ВСЕ",
            ["OTH"] = "ПРОЧ",
            ["ME"] = "ЛУГА",
            ["BF"] = "Ч.ЛЕС",
            ["OC"] = "ОКЕАН",
            ["SW"] = "БОЛОТО",
            ["MT"] = "ГОРЫ",
            ["PL"] = "РАВНИНЫ",
            ["MI"] = "ТУМАН",
            ["AS"] = "ПЕПЕЛ",
            ["DN"] = "СЕВЕР",

            // --- Патчи/подсказки ---
            ["No standard icon available."] = "Стандартная иконка недоступна.",
            ["EquipmentAndQuickSlots layout is not ready or unsupported."] = "Раскладка EquipmentAndQuickSlots не готова или не поддерживается.",
            ["Hold the radius slider to preview the area in yellow."] = "Удерживайте ползунок радиуса, чтобы увидеть область жёлтым.",


        };

        /// <summary>Префиксы динамических сообщений («Current: 5» и т.п.).</summary>
        private static readonly KeyValuePair<string, string>[] Prefixes =
        {
            new KeyValuePair<string, string>("Admin menu ", "Меню админа "),
            new KeyValuePair<string, string>("Current: ", "Сейчас: "),
            new KeyValuePair<string, string>("New: ", "Новое: "),
            new KeyValuePair<string, string>("Show ", "Показать "),
            new KeyValuePair<string, string>("Hotkey conflict: ", "Конфликт клавиш: "),
            new KeyValuePair<string, string>("Already assigned to ", "Уже назначено на "),
            new KeyValuePair<string, string>("Global time set to ", "Глобальное время: "),
            new KeyValuePair<string, string>("Local time set to ", "Локальное время: "),
            new KeyValuePair<string, string>("Local weather: ", "Погода: "),
            new KeyValuePair<string, string>("Spawn protection: ", "Защита базы: "),
            new KeyValuePair<string, string>("Custom maximum carry weight set to ", "Максимальный вес: "),
            new KeyValuePair<string, string>("Could not save cheats: ", "Не удалось сохранить читы: "),
            new KeyValuePair<string, string>("Saved carry weight was not restored: ", "Сохранённый вес не восстановлен: "),
            new KeyValuePair<string, string>("Saved inventory size was not restored: ", "Сохранённый размер инвентаря не восстановлен: "),
            new KeyValuePair<string, string>("Dungeon reset cancelled: ", "Сброс подземелий отменён: "),
            new KeyValuePair<string, string>("Inventory compatibility unavailable: ", "Совместимость инвентаря недоступна: "),
            new KeyValuePair<string, string>("Building footprint unavailable for ", "Контур постройки недоступен для "),
            new KeyValuePair<string, string>("The menu needs a shortcut so you can reopen these settings.", "Меню нужна горячая клавиша, чтобы открыть настройки снова."),
        };

        /// <summary>Переводит строку. Возвращает null, если перевода нет.</summary>
        internal static string Translate(string value)
        {
            LastWasTranslated = false;
            if (string.IsNullOrEmpty(value))
            {
                return null;
            }

            var trimmed = value.Trim();
            if (trimmed.Length == 0)
            {
                return null;
            }

            if (Exact.TryGetValue(trimmed, out var translation) && translation != null)
            {
                LastWasTranslated = true;
                return PreserveWhitespace(value, trimmed, translation);
            }

            foreach (var prefix in Prefixes)
            {
                if (value.StartsWith(prefix.Key, StringComparison.Ordinal))
                {
                    LastWasTranslated = true;
                    return prefix.Value + value.Substring(prefix.Key.Length);
                }
            }

            return null;
        }

        private static string PreserveWhitespace(string original, string trimmed, string translation)
        {
            var start = original.IndexOf(trimmed, StringComparison.Ordinal);
            if (start < 0)
            {
                return translation;
            }

            var leading = original.Substring(0, start);
            var trailing = original.Substring(start + trimmed.Length);
            return leading + translation + trailing;
        }

        /// <summary>Системный шрифт с кириллицей для переведённых надписей.</summary>
        internal static Font GetCyrillicFont(int size)
        {
            var clamped = Mathf.Clamp(size, 10, 32);
            if (CyrillicFonts.TryGetValue(clamped, out var cached) && cached != null)
            {
                return cached;
            }

            Font font = null;
            try
            {
                font = Font.CreateDynamicFontFromOSFont(
                    new[] { "Segoe UI", "Arial", "Tahoma" },
                    clamped);
            }
            catch
            {
                font = null;
            }

            CyrillicFonts[clamped] = font;
            return font;
        }
    }
}
