"""
Arabic Medical Translator for DabDar v3.0
GPT-4o powered professional medical translation with Arabic terminology
"""

import os
import json
import asyncio
from typing import Dict, Any, Optional
from openai import AsyncOpenAI
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import (
    HealthContext,
    TranslationRequest,
    TranslationResponse,
)

from .openai_client import get_default_llm_model, get_openai_client


def _load_disease_translations() -> Dict[str, str]:
    """
    Build disease name → Arabic translation map from diseases.json.

    Loads canonical names AND aliases so that lookups like
    ``DISEASE_TRANSLATIONS.get("Nipah virus")`` still work even when the
    caller hasn't normalised the name first.

    Falls back to the hardcoded ``_FALLBACK_TRANSLATIONS`` if diseases.json
    is unreadable.

    Returns:
        Dict[str, str]: English disease name/alias → Arabic translation
    """
    config_path = os.path.join(
        os.path.dirname(__file__), "..", "config", "diseases.json"
    )
    translations: Dict[str, str] = {}
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        for disease in config.get("diseases", []):
            arabic = disease.get("arabic_name", "")
            if not arabic:
                continue
            # Map canonical name
            translations[disease["name"]] = arabic
            # Map all aliases to the same Arabic name
            for alias in disease.get("aliases", []):
                translations[alias] = arabic
    except Exception as e:
        print(f"⚠️ Could not load diseases.json for translations: {e}")
        return dict(_FALLBACK_TRANSLATIONS)
    return translations


# Hardcoded fallback — used only if diseases.json is unreadable
_FALLBACK_TRANSLATIONS: Dict[str, str] = {
    "Mpox": "جدري القردة",
    "Monkeypox": "جدري القردة",
    "Marburg": "ماربورغ",
    "MERS": "متلازمة الشرق الأوسط التنفسية",
    "Cholera": "الكوليرا",
    "Measles": "الحصبة",
    "H5N1": "إنفلونزا الطيور",
    "Dengue": "حمى الضنك",
    "Ebola": "إيبولا",
    "COVID-19": "كوفيد-19",
    "Yellow Fever": "الحمى الصفراء",
    "Polio": "شلل الأطفال",
    "Lassa Fever": "حمى لاسا",
    "Nipah": "فيروس نيباه",
    "Typhoid": "حمى التيفوئيد",
    "Plague": "الطاعون",
    "Anthrax": "الجمرة الخبيثة",
}


# Medical terminology dictionary (English -> Arabic)
MEDICAL_TERMINOLOGY = {
    # Disease-related terms
    "outbreak": "تفشي المرض",
    "epidemic": "وباء",
    "pandemic": "جائحة",
    "endemic": "متوطن",
    "infection": "عدوى",
    "disease": "مرض",
    "virus": "فيروس",
    "bacteria": "بكتيريا",
    "pathogen": "عامل ممرض",
    # Case-related terms
    "case": "حالة",
    "cases": "حالات",
    "confirmed case": "حالة مؤكدة",
    "confirmed cases": "حالات مؤكدة",
    "suspected case": "حالة مشتبه بها",
    "suspected cases": "حالات مشتبه بها",
    "death": "وفاة",
    "deaths": "وفيات",
    "fatality": "وفاة",
    "fatalities": "وفيات",
    "mortality rate": "معدل الوفيات",
    "case fatality rate": "معدل إماتة الحالات",
    "morbidity": "معدل الاعتلال",
    # Response terms
    "intervention": "تدخل",
    "response": "استجابة",
    "vaccination": "تطعيم",
    "vaccine": "لقاح",
    "treatment": "علاج",
    "quarantine": "حجر صحي",
    "isolation": "عزل",
    "containment": "احتواء",
    "surveillance": "مراقبة وبائية",
    "contact tracing": "تتبع المخالطين",
    # Risk terms
    "risk assessment": "تقييم المخاطر",
    "high risk": "خطورة عالية",
    "moderate risk": "خطورة متوسطة",
    "low risk": "خطورة منخفضة",
    "public health emergency": "طوارئ صحية عامة",
    "PHEIC": "طوارئ صحية عامة تثير قلقاً دولياً",
    # Organizations
    "World Health Organization": "منظمة الصحة العالمية",
    "WHO": "منظمة الصحة العالمية",
    "CDC": "مراكز السيطرة على الأمراض والوقاية منها",
    "Centers for Disease Control": "مراكز السيطرة على الأمراض والوقاية منها",
    # Epidemiological terms
    "epidemiological triad": "المثلث الوبائي",
    "incubation period": "فترة الحضانة",
    "transmission": "انتقال العدوى",
    "human-to-human transmission": "انتقال من إنسان لإنسان",
    "zoonotic": "حيواني المنشأ",
    "vector-borne": "ينتقل عبر ناقل",
    "airborne": "ينتقل عبر الهواء",
    "droplet": "رذاذ",
    "asymptomatic": "بدون أعراض",
    "symptomatic": "عرضي",
    # Geographic terms
    "region": "منطقة",
    "country": "دولة",
    "province": "محافظة",
    "district": "مقاطعة",
    "affected area": "منطقة متأثرة",
    "affected areas": "مناطق متأثرة",
    # Time terms
    "period": "فترة",
    "during": "خلال",
    "since": "منذ",
    "until": "حتى",
    "ongoing": "مستمر",
    "current": "حالي",
    "previous": "سابق",
}

# Disease names Arabic translations — loaded dynamically from diseases.json
# Rebuilt at module import and can be refreshed via reload_disease_translations()
DISEASE_TRANSLATIONS: Dict[str, str] = _load_disease_translations()


def reload_disease_translations() -> None:
    """Reload DISEASE_TRANSLATIONS from diseases.json (e.g. after adding a new disease)."""
    global DISEASE_TRANSLATIONS
    DISEASE_TRANSLATIONS = _load_disease_translations()
    print(
        f"🌐 Reloaded {len(DISEASE_TRANSLATIONS)} disease translations from diseases.json"
    )


class ArabicMedicalTranslator:
    """Professional medical translator for English to Arabic"""

    TRANSLATION_PROMPT_TEMPLATE = """You are a professional medical translator specializing in public health and epidemiology. 
Translate the following English text to Arabic following these guidelines:

1. Use formal Modern Standard Arabic (الفصحى)
2. Preserve medical terminology accurately using standardized Arabic medical terms
3. Use WHO/Arab medical dictionary standardized terms
4. Maintain the epidemiological context and scientific accuracy
5. Keep numbers, dates, and organization names in their original format (use Western numerals)
6. Ensure the translation reads naturally in Arabic while maintaining precision
7. Use proper Arabic punctuation and formatting

IMPORTANT: This is a medical/health document. Accuracy is critical.

Medical Terms Reference:
- Outbreak = تفشي المرض / فاشية
- Epidemic = وباء
- Pandemic = جائحة
- Confirmed cases = حالات مؤكدة
- Deaths/Fatalities = وفيات
- Intervention = تدخل / إجراء
- Surveillance = مراقبة وبائية
- Risk assessment = تقييم المخاطر
- Public Health Emergency = طوارئ صحية عامة

Disease Names:
{disease_names_section}

TEXT TO TRANSLATE:
{text}

Provide ONLY the Arabic translation, nothing else."""

    def __init__(self) -> None:
        self.model = os.getenv(
            "OPENROUTER_TRANSLATION_MODEL",
            os.getenv("OPENAI_TRANSLATION_MODEL", get_default_llm_model()),
        )
        self.max_retries = int(os.getenv("TRANSLATION_MAX_RETRIES", "3"))

    @staticmethod
    def _build_disease_names_section() -> str:
        """Build the 'Disease Names' block for the translation prompt from DISEASE_TRANSLATIONS."""
        # Use only canonical names (those that match diseases.json "name" field)
        # to keep the prompt concise. Aliases map to the same Arabic anyway.
        seen: Dict[str, str] = {}
        for eng, ar in DISEASE_TRANSLATIONS.items():
            if eng not in seen:
                seen[eng] = ar
        # Limit to ~25 unique Arabic names to keep the prompt manageable
        unique_pairs: Dict[str, str] = {}
        for eng, ar in seen.items():
            if ar not in unique_pairs.values() or len(unique_pairs) < 30:
                unique_pairs[eng] = ar
        return "\n".join(f"- {eng} = {ar}" for eng, ar in unique_pairs.items())

    def _build_prompt(self, text: str) -> str:
        """Build the full translation prompt with current disease names."""
        return self.TRANSLATION_PROMPT_TEMPLATE.format(
            disease_names_section=self._build_disease_names_section(),
            text=text,
        )

    def _get_client(self) -> AsyncOpenAI:
        """Lazy load OpenRouter client via shared helper."""
        return get_openai_client()

    async def translate_text(
        self,
        text_en: str,
        is_short: bool = False,
        disease_context: Optional[str] = None,
    ) -> str:
        """
        Translate English text to Arabic.

        Args:
            text_en: English text to translate
            is_short: Whether this is a short description
            disease_context: Optional disease name for context

        Returns:
            Arabic translation
        """
        if not text_en or not text_en.strip():
            return ""

        # Build context-aware prompt (dynamically includes disease names from diseases.json)
        prompt = self._build_prompt(text=text_en)

        if disease_context:
            arabic_disease = DISEASE_TRANSLATIONS.get(disease_context, disease_context)
            prompt = f"Context: This text is about {disease_context} ({arabic_disease}).\n\n{prompt}"

        for attempt in range(1, self.max_retries + 1):
            try:
                response = await self._get_client().chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a professional medical translator. Respond only with the Arabic translation.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.1,  # Low temperature for accuracy
                    max_tokens=2000,
                )

                translation = response.choices[0].message.content
                return translation.strip() if translation else ""

            except Exception as e:
                is_last_attempt = attempt >= self.max_retries
                error_text = str(e).lower()
                is_rate_limit = "429" in error_text or "rate limit" in error_text

                if is_last_attempt or not is_rate_limit:
                    print(f"❌ Translation error: {e}")
                    return ""

                backoff_seconds = float(2**attempt)
                print(
                    f"⚠️ Translation rate-limited (attempt {attempt}/{self.max_retries}), retrying in {backoff_seconds:.1f}s"
                )
                await asyncio.sleep(backoff_seconds)

        return ""

    async def translate_finding(self, finding: Dict[str, Any]) -> Dict[str, Any]:
        """
        Translate a complete finding's descriptions.

        Args:
            finding: Finding dictionary with English descriptions

        Returns:
            Finding with Arabic translations added
        """
        disease = finding.get("disease", "")

        # Translate short description
        short_en = finding.get("short_description_en", "")
        if short_en:
            short_ar = await self.translate_text(
                short_en, is_short=True, disease_context=disease
            )
            finding["short_description_ar"] = short_ar

        # Translate detailed description
        detailed_en = finding.get("detailed_description_en", "")
        if detailed_en:
            detailed_ar = await self.translate_text(
                detailed_en, is_short=False, disease_context=disease
            )
            finding["detailed_description_ar"] = detailed_ar

        return finding

    async def batch_translate(self, findings: list, max_concurrent: int = 2) -> list:
        """
        Translate multiple findings in parallel with bounded concurrency.

        Args:
            findings: List of finding dictionaries
            max_concurrent: Maximum parallel translation calls (default 5)

        Returns:
            List of findings with Arabic translations
        """
        import asyncio

        semaphore = asyncio.Semaphore(max_concurrent)

        async def translate_with_semaphore(finding: dict) -> dict:
            async with semaphore:
                try:
                    return await self.translate_finding(finding)
                except Exception as e:
                    print(f"⚠️ Translation failed for finding: {e}")
                    finding["short_description_ar"] = ""
                    finding["detailed_description_ar"] = ""
                    return finding

        tasks = [translate_with_semaphore(f) for f in findings]
        translated = await asyncio.gather(*tasks, return_exceptions=True)

        results = []
        for result in translated:
            if isinstance(result, Exception):
                print(f"⚠️ Translation task failed: {result}")
                results.append(
                    {"short_description_ar": "", "detailed_description_ar": ""}
                )
            else:
                results.append(result)

        return results


# Global translator instance
arabic_translator = ArabicMedicalTranslator()


@function_tool
async def translate_to_arabic(
    ctx: RunContextWrapper[HealthContext], text_en: str, disease_context: str = ""
) -> str:
    """
    Translate English text to Arabic with medical terminology.

    Args:
        text_en: English text to translate
        disease_context: Optional disease name for context-aware translation

    Returns:
        Arabic translation
    """
    ctx.context.log(f"🔄 Translating to Arabic: {text_en[:50]}...")

    translation = await arabic_translator.translate_text(
        text_en, disease_context=disease_context if disease_context else None
    )

    if translation:
        ctx.context.log(f"✅ Translation complete ({len(translation)} chars)")
    else:
        ctx.context.log("⚠️ Translation returned empty")

    return translation


@function_tool
async def translate_finding(
    ctx: RunContextWrapper[HealthContext], finding_json: str
) -> str:
    """
    Translate a finding's descriptions to Arabic.

    Args:
        finding_json: JSON string of the finding

    Returns:
        JSON string of finding with Arabic translations
    """
    finding = json.loads(finding_json)

    headline = finding.get("headline", "")[:50]
    ctx.context.log(f"🔄 Translating finding: {headline}...")

    translated = await arabic_translator.translate_finding(finding)

    ctx.context.log(f"✅ Finding translated")

    return json.dumps(translated, ensure_ascii=False)


@function_tool
async def batch_translate_findings(
    ctx: RunContextWrapper[HealthContext], findings_json: str
) -> str:
    """
    Translate multiple findings to Arabic.

    Args:
        findings_json: JSON array of findings

    Returns:
        JSON array of findings with Arabic translations
    """
    findings = json.loads(findings_json)

    ctx.context.log(f"🔄 Batch translating {len(findings)} findings to Arabic...")

    translated = await arabic_translator.batch_translate(findings)

    ctx.context.log(f"✅ Batch translation complete: {len(translated)} findings")

    return json.dumps(translated, ensure_ascii=False)


@function_tool
async def get_arabic_disease_name(
    ctx: RunContextWrapper[HealthContext], disease_en: str
) -> str:
    """
    Get the Arabic name for a disease.

    Args:
        disease_en: English disease name

    Returns:
        Arabic disease name
    """
    arabic_name = DISEASE_TRANSLATIONS.get(disease_en, "")

    if arabic_name:
        ctx.context.log(f"✅ {disease_en} → {arabic_name}")
    else:
        ctx.context.log(f"⚠️ No Arabic translation found for: {disease_en}")

    return arabic_name


@function_tool
async def get_arabic_medical_term(
    ctx: RunContextWrapper[HealthContext], term_en: str
) -> str:
    """
    Get the Arabic translation of a medical term.

    Args:
        term_en: English medical term

    Returns:
        Arabic medical term
    """
    term_lower = term_en.lower()
    arabic_term = MEDICAL_TERMINOLOGY.get(term_lower, "")

    if arabic_term:
        ctx.context.log(f"✅ {term_en} → {arabic_term}")
    else:
        ctx.context.log(f"⚠️ No Arabic translation found for: {term_en}")

    return arabic_term
