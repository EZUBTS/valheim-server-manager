// Русский перевод интерфейса Valheim Admin Tool (VAT) без изменения самого мода.
//
// Принцип: Harmony-патч на UnityEngine.UI.Text.set_text. Когда VAT (или любой
// другой UI) присваивает тексту английскую подпись, известную словарю, подпись
// заменяется на русскую ещё до отрисовки. Сам DLL Valheim Admin Tool не
// изменяется — это отдельный клиентский мод-переводчик.
//
// Для кириллицы каждому переведённому Text принудительно ставится системный
// шрифт (Segoe UI), потому что шрифт Valheim может не содержать русских глифов
// в том виде, в котором его использует VAT.

using System;
using System.Collections.Generic;
using BepInEx;
using BepInEx.Logging;
using HarmonyLib;
using UnityEngine;
using UnityEngine.UI;

namespace ValheimRuVatTranslation
{
    [BepInPlugin(Guid, "Русский перевод Valheim Admin Tool", Version)]
    public sealed class TranslationPlugin : BaseUnityPlugin
    {
        internal const string Guid = "ru.valheim.vat.russian";
        internal const string Version = "1.0.0";
        internal static ManualLogSource Log;
        internal static Harmony HarmonyInstance;

        private void Awake()
        {
            Log = Logger;
            HarmonyInstance = new Harmony(Guid);
            try
            {
                var setter = AccessTools.PropertySetter(typeof(Text), "text");
                HarmonyInstance.Patch(
                    setter,
                    prefix: new HarmonyMethod(typeof(TranslationPlugin), nameof(TextSetPrefix)),
                    postfix: new HarmonyMethod(typeof(TranslationPlugin), nameof(TextSetPostfix)));
                Logger.LogInfo("Русский перевод VAT загружен (перехват UI.Text.text).");
            }
            catch (Exception error)
            {
                Logger.LogError("Не удалось установить патч перевода: " + error);
            }
        }

        private void OnDestroy()
        {
            HarmonyInstance?.UnpatchSelf();
        }

        /// <summary>Подменяет английскую подпись на русскую до set_text.</summary>
        private static void TextSetPrefix(ref string value)
        {
            var translated = RussianStrings.Translate(value);
            if (translated != null)
            {
                value = translated;
            }
        }

        /// <summary>Для переведённых надписей ставит шрифт с кириллицей.</summary>
        private static void TextSetPostfix(Text __instance, string value)
        {
            if (__instance == null || string.IsNullOrEmpty(value))
            {
                return;
            }

            if (!RussianStrings.LastWasTranslated)
            {
                return;
            }

            var font = RussianStrings.GetCyrillicFont(__instance.fontSize);
            if (font != null && __instance.font != font)
            {
                __instance.font = font;
            }
        }
    }
}
