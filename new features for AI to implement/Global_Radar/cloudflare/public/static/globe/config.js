// ============================================================================
//  SehaRadar Map — Main Application Script
// ============================================================================

// ----- Constants & Config -----

// Risk classes for outbreaks (news is intentionally outside risk scoring)
const RISK_COLORS = {
    unclassified: '#64748B',
    no_risk: '#22C55E',
    low: '#84CC16',
    medium: '#EAB308',
    high: '#F97316',
    critical: '#EF4444',
    news: '#06B6D4',
};

const OUTBREAK_COUNTRY_RISK_COLORS = {
    medium: '#16A34A',
    high: '#EAB308',
    critical: '#DC2626',
};

const RISK_EDIT_OPTIONS = ['unclassified', 'no_risk', 'low', 'medium', 'high', 'critical'];

const RISK_CLASS_ORDER = {
    unclassified: 0,
    no_risk: 1,
    low: 2,
    medium: 3,
    high: 4,
    critical: 5,
};

const TRAVEL_RISK_COLORS = {
    green: '#16A34A',
    yellow: '#EAB308',
    red: '#DC2626',
    unknown: '#6B7280',
};

const OUTBREAK_COUNTRY_BORDER_COLOR = 'rgba(148, 163, 184, 0.22)';

const TRAVEL_RISK_LABEL_KEYS = {
    green: 'travel_risk_green',
    yellow: 'travel_risk_yellow',
    red: 'travel_risk_red',
    unknown: 'travel_risk_unknown',
};

const TRAVEL_ALL_HEALTH_RISKS_SLUG = '__all__';
const TRAVEL_HEALTH_ICON_BASE = 'https://api.iconify.design';
const TRAVEL_HEALTH_ICON_SIZE = 16;
const TRAVEL_DEFAULT_HEALTH_RISK_VISUAL = {
    icon: 'mdi:virus-outline',
    color: '#6B7280',
    size: TRAVEL_HEALTH_ICON_SIZE,
};
const TRAVEL_HEALTH_RISK_VISUALS = {
    'mpox': { name: 'Mpox', icon: 'mdi:hand', color: '#F97316' },
    'marburg': { name: 'Marburg', icon: 'covid:covid-carrier-blood-2', color: '#EF4444' },
    'mers': { name: 'MERS', icon: 'arcticons:emoji-bactrian-camel', color: '#EAB308' },
    'cholera': { name: 'Cholera', icon: 'entypo:water', color: '#3B82F6' },
    'measles': { name: 'Measles', icon: 'healthicons:measles', color: '#06B6D4' },
    'h5n1': { name: 'H5N1', icon: 'healthicons:animal-chicken-outline', color: '#A855F7' },
    'dengue': { name: 'Dengue', icon: 'healthicons:mosquito-outline', color: '#EC4899' },
    'ebola': { name: 'Ebola', icon: 'lucide:skull', color: '#F97316' },
    'covid-19': { name: 'COVID-19', icon: 'covid:covid-carrier-human', color: '#06B6D4' },
    'yellow-fever': { name: 'Yellow Fever', icon: 'mi:temperature', color: '#FBBF24' },
    'polio': { name: 'Polio', icon: 'fontisto:paralysis-disability', color: '#14B8A6' },
    'lassa-fever': { name: 'Lassa Fever', icon: 'lucide:rat', color: '#EC4899' },
    'malaria': { name: 'Malaria', icon: 'healthicons:malaria-microscope-outline', color: '#14B8A6' },
    'nipah': { name: 'Nipah', icon: 'mdi:virus', color: '#6366F1' },
    'rift-valley-fever': { name: 'Rift Valley Fever', icon: 'healthicons:mosquito-outline', color: '#F59E0B' },
    'plague': { name: 'Plague', icon: 'mdi:biohazard', color: '#8B5CF6' },
    'influenza': { name: 'Influenza', icon: 'healthicons:cold-chain-outline', color: '#38BDF8' },
    'zika': { name: 'Zika', icon: 'healthicons:mosquito-outline', color: '#0EA5E9' },
    'chikungunya': { name: 'Chikungunya', icon: 'healthicons:mosquito-outline', color: '#FB923C' },
    'salmonella': { name: 'Salmonella', icon: 'healthicons:bacteria', color: '#E11D48' },
    'norovirus': { name: 'Norovirus', icon: 'mdi:virus-outline', color: '#7C3AED' },
    'rabies': { name: 'Rabies', icon: 'mdi:dog-side', color: '#B91C1C' },
    'hepatitis': { name: 'Hepatitis', icon: 'healthicons:liver', color: '#CA8A04' },
    'crimean-congo-hemorrhagic-fever': { name: 'Crimean-Congo Hemorrhagic Fever', icon: 'healthicons:blood-drop', color: '#9F1239' },
    'tuberculosis': { name: 'Tuberculosis', icon: 'healthicons:lungs', color: '#854D0E' },
    'diphtheria': { name: 'Diphtheria', icon: 'healthicons:pneumonia', color: '#8B5CF6' },
    'legionellosis': { name: 'Legionellosis', icon: 'healthicons:pneumonia', color: '#0369A1' },
    'african-swine-fever': { name: 'African Swine Fever', icon: 'mdi:pig-variant-outline', color: '#9D174D' },
    'rocky-mountain-spotted-fever': { name: 'Rocky Mountain Spotted Fever', icon: 'mdi:bug-outline', color: '#92400E' },
    'infant-botulism': { name: 'Infant Botulism', icon: 'mdi:bacteria', color: '#6B21A8' },
    'meningitis': { name: 'Meningitis', icon: 'healthicons:neurology', color: '#1D4ED8' },
    'varicella': { name: 'Varicella', icon: 'healthicons:measles', color: '#15803D' },
    'bacillus-cereus': { name: 'Bacillus cereus', icon: 'mdi:bacteria-outline', color: '#A16207' },
    'hantavirus': { name: 'Hantavirus', icon: 'mdi:rodent', color: '#7F1D1D' },
    'foot-and-mouth-disease': { name: 'Foot and Mouth Disease', icon: 'mdi:cow', color: '#065F46' },
    'e-coli': { name: 'E. coli', icon: 'healthicons:bacteria', color: '#B45309' },
    'leptospirosis': { name: 'Leptospirosis', icon: 'healthicons:bacteria', color: '#0E7490' },
    'lumpy-skin-disease': { name: 'Lumpy Skin Disease', icon: 'mdi:cow', color: '#78350F' },
    'rhinovirus': { name: 'Rhinovirus', icon: 'healthicons:cold-chain-outline', color: '#6D28D9' },
    'new-world-screwworm': { name: 'New World Screwworm', icon: 'mdi:bug', color: '#991B1B' },
    'kyasanur-forest-disease': { name: 'Kyasanur Forest Disease', icon: 'mdi:bug-outline', color: '#713F12' },
    'psittacosis': { name: 'Psittacosis', icon: 'mdi:bird', color: '#4C1D95' },
    'listeriosis': { name: 'Listeriosis', icon: 'mdi:bacteria', color: '#064E3B' },
    'mycobacterium-abscessus-complex': { name: 'Mycobacterium abscessus complex', icon: 'healthicons:bacteria', color: '#312E81' },
    'equine-herpesvirus': { name: 'Equine Herpesvirus', icon: 'mdi:horse', color: '#701A75' },
    'campylobacter-enterocolitis': { name: 'Campylobacter enterocolitis', icon: 'healthicons:stomach', color: '#9A3412' },
    'tomato-brown-rugose-fruit-virus': { name: 'Tomato Brown Rugose Fruit Virus', icon: 'mdi:leaf', color: '#166534' },
    'tick-borne-encephalitis': { name: 'Tick-borne encephalitis', icon: 'mdi:bug-outline', color: '#5B21B6' },
    'leprosy': { name: 'Leprosy', icon: 'healthicons:bacteria', color: '#92400E' },
    'wheat-dwarf-virus': { name: 'Wheat Dwarf Virus', icon: 'mdi:sprout', color: '#3F6212' },
    'bovine-respiratory-disease-complex': { name: 'Bovine respiratory disease complex', icon: 'mdi:cow', color: '#1E3A5F' },
    'newcastle-disease': { name: 'Newcastle disease', icon: 'healthicons:animal-chicken-outline', color: '#B45309' },
    'equine-infectious-anemia': { name: 'Equine Infectious Anemia', icon: 'mdi:horse-variant', color: '#881337' },
    'cutibacterium-acnes-infection': { name: 'Cutibacterium acnes infection', icon: 'mdi:bacteria-outline', color: '#475569' },
    'shigellosis': { name: 'Shigellosis', icon: 'healthicons:bacteria', color: '#B91C1C' },
    'burkholderia-stabilis': { name: 'Burkholderia stabilis', icon: 'mdi:bacteria-outline', color: '#334155' },
    'pteropine-orthoreovirus': { name: 'Pteropine Orthoreovirus', icon: 'mdi:bat', color: '#581C87' },
    'dirofilariasis': { name: 'Dirofilariasis', icon: 'mdi:dog-side', color: '#7C2D12' },
    'respiratory-syncytial-virus': { name: 'Respiratory syncytial virus', icon: 'healthicons:lungs', color: '#0284C7' },
    'chronic-wasting-disease': { name: 'Chronic Wasting Disease', icon: 'game-icons:deer', color: '#365314' },
    'lyme-disease': { name: 'Lyme disease', icon: 'mdi:bug-outline', color: '#4D7C0F' },
    'trichophyton-mentagrophytes': { name: 'Trichophyton mentagrophytes', icon: 'mdi:mushroom', color: '#78716C' },
    'anthrax': { name: 'Anthrax', icon: 'mdi:biohazard', color: '#450A0A' },
    'pertussis': { name: 'Pertussis', icon: 'healthicons:pneumonia', color: '#1E40AF' },
    'typhoid': { name: 'Typhoid', icon: 'healthicons:bacteria', color: '#D97706' },
    'oropouche': { name: 'Oropouche', icon: 'healthicons:mosquito-outline', color: '#C2410C' },
    'endophthalmitis': { name: 'Endophthalmitis', icon: 'healthicons:eye', color: '#6B7280' },
    'mumps': { name: 'Mumps', icon: 'mdi:virus', color: '#22C55E' },
};

function getRiskColor(riskClass) {
    return RISK_COLORS[riskClass] || RISK_COLORS.unclassified;
}

function normalizeTravelRiskCode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'unknown';
    if (['green', 'low', 'low risk'].includes(normalized)) return 'green';
    if (['yellow', 'medium', 'moderate', 'moderate risk'].includes(normalized)) return 'yellow';
    if (['red', 'high', 'critical', 'do not travel'].includes(normalized)) return 'red';
    return 'unknown';
}

function getTravelRiskColor(riskCode, fallbackColor = '') {
    const normalized = normalizeTravelRiskCode(riskCode);
    if (fallbackColor && normalized !== 'unknown') return String(fallbackColor);
    return TRAVEL_RISK_COLORS[normalized] || TRAVEL_RISK_COLORS.unknown;
}

function getTravelRiskLabel(riskCode) {
    const normalized = normalizeTravelRiskCode(riskCode);
    return t(TRAVEL_RISK_LABEL_KEYS[normalized] || TRAVEL_RISK_LABEL_KEYS.unknown);
}

function normalizeSlug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

function normalizeTravelHealthRiskName(value, fallback) {
    const name = String(value || '').trim();
    return name || fallback;
}

function getTravelHealthRiskIconUrl(icon, color) {
    return `${TRAVEL_HEALTH_ICON_BASE}/${icon}.svg?color=${encodeURIComponent(color)}`;
}

function getTravelHealthRiskVisual(name, slug) {
    const slugKey = normalizeSlug(slug || '');
    const nameKey = normalizeSlug(name || '');
    const matched = TRAVEL_HEALTH_RISK_VISUALS[slugKey] || TRAVEL_HEALTH_RISK_VISUALS[nameKey];
    if (!matched) {
        const safeName = normalizeTravelHealthRiskName(name, slugKey || 'Health Risk');
        return {
            name: safeName,
            icon: TRAVEL_DEFAULT_HEALTH_RISK_VISUAL.icon,
            color: TRAVEL_DEFAULT_HEALTH_RISK_VISUAL.color,
            size: TRAVEL_DEFAULT_HEALTH_RISK_VISUAL.size,
            iconUrl: getTravelHealthRiskIconUrl(
                TRAVEL_DEFAULT_HEALTH_RISK_VISUAL.icon,
                TRAVEL_DEFAULT_HEALTH_RISK_VISUAL.color,
            ),
        };
    }
    return {
        name: matched.name,
        icon: matched.icon,
        color: matched.color,
        size: TRAVEL_HEALTH_ICON_SIZE,
        iconUrl: getTravelHealthRiskIconUrl(matched.icon, matched.color),
    };
}

const DISEASE_COLORS = {
    'Mpox': [249, 115, 22],
    'Marburg': [239, 68, 68],
    'MERS': [234, 179, 8],
    'Cholera': [59, 130, 246],
    'Measles': [34, 197, 94],
    'H5N1': [168, 85, 247],
    'Dengue': [120, 113, 108],
    'Ebola': [220, 38, 38],
    'COVID-19': [6, 182, 212],
    'Yellow Fever': [251, 191, 36],
    'Polio': [20, 184, 166],
    'Lassa Fever': [236, 72, 153],
    'Malaria': [16, 185, 129],
    'Nipah': [99, 102, 241],
    'Rift Valley Fever': [245, 158, 11],
    'Plague': [139, 92, 246],
    'Influenza': [56, 189, 248],
    'Zika': [14, 165, 233],
    'Chikungunya': [251, 146, 60],
    'news': [100, 116, 139],
    // --- Phase 2: additional diseases ---
    'Salmonella': [225, 29, 72],
    'Norovirus': [124, 58, 237],
    'Rabies': [185, 28, 28],
    'Hepatitis': [202, 138, 4],
    'Crimean-Congo Hemorrhagic Fever': [159, 18, 57],
    'Tuberculosis': [133, 77, 14],
    'Diphtheria': [67, 56, 202],
    'Legionellosis': [3, 105, 161],
    'African Swine Fever': [157, 23, 77],
    'Rocky Mountain Spotted Fever': [146, 64, 14],
    'Infant Botulism': [107, 33, 168],
    'Meningitis': [29, 78, 216],
    'Varicella': [21, 128, 61],
    'Bacillus cereus': [161, 98, 7],
    'Hantavirus': [127, 29, 29],
    'Foot and Mouth Disease': [6, 95, 70],
    'E. coli': [180, 83, 9],
    'Leptospirosis': [14, 116, 144],
    'Lumpy Skin Disease': [120, 53, 15],
    'Rhinovirus': [109, 40, 217],
    'New World Screwworm': [153, 27, 27],
    'Kyasanur Forest Disease': [113, 63, 18],
    'Psittacosis': [76, 29, 149],
    'Listeriosis': [6, 78, 59],
    'Mycobacterium abscessus complex': [49, 46, 129],
    'Equine Herpesvirus': [112, 26, 117],
    'Campylobacter enterocolitis': [154, 52, 18],
    'Tomato Brown Rugose Fruit Virus': [22, 101, 52],
    'Tick-borne encephalitis': [91, 33, 182],
    'Leprosy': [146, 64, 14],
    'Wheat Dwarf Virus': [63, 98, 18],
    'bovine respiratory disease complex': [30, 58, 95],
    'Newcastle disease': [180, 83, 9],
    'Equine Infectious Anemia': [136, 19, 55],
    'Cutibacterium acnes infection': [71, 85, 105],
    'Shigellosis': [185, 28, 28],
    'Burkholderia stabilis': [51, 65, 85],
    'Pteropine Orthoreovirus': [88, 28, 135],
    'Dirofilariasis': [124, 45, 18],
    'Respiratory syncytial virus': [2, 132, 199],
    'Chronic Wasting Disease': [54, 83, 20],
    'Lyme disease': [77, 124, 15],
    'Trichophyton mentagrophytes': [120, 113, 108],
    'Anthrax': [69, 10, 10],
    'Pertussis': [30, 64, 175],
    'Typhoid': [217, 119, 6],
    'Oropouche': [194, 65, 12],
    'Endophthalmitis': [107, 114, 128],
};

// Iconify icon names for each disease
const DISEASE_ICONS = {
    'Mpox': 'mdi:hand',
    'Marburg': 'covid:covid-carrier-blood-2',
    'MERS': 'arcticons:emoji-bactrian-camel',
    'Cholera': 'entypo:water',
    'Measles': 'healthicons:measles',
    'H5N1': 'healthicons:animal-chicken-outline',
    'Dengue': 'healthicons:mosquito-outline',
    'Ebola': 'lucide:skull',
    'COVID-19': 'covid:covid-carrier-human',
    'Yellow Fever': 'mi:temperature',
    'Polio': 'fontisto:paralysis-disability',
    'Lassa Fever': 'lucide:rat',
    'Malaria': 'healthicons:malaria-microscope-outline',
    'Nipah': 'mdi:virus',
    'Rift Valley Fever': 'healthicons:mosquito-outline',
    'Plague': 'mdi:biohazard',
    'Influenza': 'healthicons:cold-chain-outline',
    'Zika': 'healthicons:mosquito-outline',
    'Chikungunya': 'healthicons:mosquito-outline',
    'news': 'mdi:newspaper-variant-outline',
    // --- Phase 2: additional diseases ---
    'Salmonella': 'healthicons:bacteria',
    'Norovirus': 'mdi:virus-outline',
    'Rabies': 'mdi:dog-side',
    'Hepatitis': 'healthicons:liver',
    'Crimean-Congo Hemorrhagic Fever': 'healthicons:blood-drop',
    'Tuberculosis': 'healthicons:lungs',
    'Diphtheria': 'healthicons:pneumonia',
    'Legionellosis': 'healthicons:pneumonia',
    'African Swine Fever': 'mdi:pig-variant-outline',
    'Rocky Mountain Spotted Fever': 'mdi:bug-outline',
    'Infant Botulism': 'mdi:bacteria',
    'Meningitis': 'healthicons:neurology',
    'Varicella': 'healthicons:measles',
    'Bacillus cereus': 'mdi:bacteria-outline',
    'Hantavirus': 'mdi:rodent',
    'Foot and Mouth Disease': 'mdi:cow',
    'E. coli': 'healthicons:bacteria',
    'Leptospirosis': 'healthicons:bacteria',
    'Lumpy Skin Disease': 'mdi:cow',
    'Rhinovirus': 'healthicons:cold-chain-outline',
    'New World Screwworm': 'mdi:bug',
    'Kyasanur Forest Disease': 'mdi:bug-outline',
    'Psittacosis': 'mdi:bird',
    'Listeriosis': 'mdi:bacteria',
    'Mycobacterium abscessus complex': 'healthicons:bacteria',
    'Equine Herpesvirus': 'mdi:horse',
    'Campylobacter enterocolitis': 'healthicons:stomach',
    'Tomato Brown Rugose Fruit Virus': 'mdi:leaf',
    'Tick-borne encephalitis': 'mdi:bug-outline',
    'Leprosy': 'healthicons:bacteria',
    'Wheat Dwarf Virus': 'mdi:sprout',
    'bovine respiratory disease complex': 'mdi:cow',
    'Newcastle disease': 'healthicons:animal-chicken-outline',
    'Equine Infectious Anemia': 'mdi:horse-variant',
    'Cutibacterium acnes infection': 'mdi:bacteria-outline',
    'Shigellosis': 'healthicons:bacteria',
    'Burkholderia stabilis': 'mdi:bacteria-outline',
    'Pteropine Orthoreovirus': 'mdi:bat',
    'Dirofilariasis': 'mdi:dog-side',
    'Respiratory syncytial virus': 'healthicons:lungs',
    'Chronic Wasting Disease': 'game-icons:deer',
    'Lyme disease': 'mdi:bug-outline',
    'Trichophyton mentagrophytes': 'mdi:mushroom',
    'Anthrax': 'mdi:biohazard',
    'Pertussis': 'healthicons:pneumonia',
    'Typhoid': 'healthicons:bacteria',
    'Oropouche': 'healthicons:mosquito-outline',
    'Endophthalmitis': 'healthicons:eye',
};

const DISEASE_COLORS_HEX = {
    'Mpox': '#F97316',
    'Marburg': '#EF4444',
    'MERS': '#EAB308',
    'Cholera': '#3B82F6',
    'Measles': '#22C55E',
    'H5N1': '#A855F7',
    'Dengue': '#78716C',
    'Ebola': '#DC2626',
    'COVID-19': '#06B6D4',
    'Yellow Fever': '#FBBF24',
    'Polio': '#14B8A6',
    'Lassa Fever': '#EC4899',
    'Malaria': '#10B981',
    'Nipah': '#6366F1',
    'Rift Valley Fever': '#F59E0B',
    'Plague': '#8B5CF6',
    'Influenza': '#38BDF8',
    'Zika': '#0EA5E9',
    'Chikungunya': '#FB923C',
    'news': '#64748b',
    // --- Phase 2: additional diseases ---
    'Salmonella': '#E11D48',
    'Norovirus': '#7C3AED',
    'Rabies': '#B91C1C',
    'Hepatitis': '#CA8A04',
    'Crimean-Congo Hemorrhagic Fever': '#9F1239',
    'Tuberculosis': '#854D0E',
    'Diphtheria': '#4338CA',
    'Legionellosis': '#0369A1',
    'African Swine Fever': '#9D174D',
    'Rocky Mountain Spotted Fever': '#92400E',
    'Infant Botulism': '#6B21A8',
    'Meningitis': '#1D4ED8',
    'Varicella': '#15803D',
    'Bacillus cereus': '#A16207',
    'Hantavirus': '#7F1D1D',
    'Foot and Mouth Disease': '#065F46',
    'E. coli': '#B45309',
    'Leptospirosis': '#0E7490',
    'Lumpy Skin Disease': '#78350F',
    'Rhinovirus': '#6D28D9',
    'New World Screwworm': '#991B1B',
    'Kyasanur Forest Disease': '#713F12',
    'Psittacosis': '#4C1D95',
    'Listeriosis': '#064E3B',
    'Mycobacterium abscessus complex': '#312E81',
    'Equine Herpesvirus': '#701A75',
    'Campylobacter enterocolitis': '#9A3412',
    'Tomato Brown Rugose Fruit Virus': '#166534',
    'Tick-borne encephalitis': '#5B21B6',
    'Leprosy': '#92400E',
    'Wheat Dwarf Virus': '#3F6212',
    'bovine respiratory disease complex': '#1E3A5F',
    'Newcastle disease': '#B45309',
    'Equine Infectious Anemia': '#881337',
    'Cutibacterium acnes infection': '#475569',
    'Shigellosis': '#B91C1C',
    'Burkholderia stabilis': '#334155',
    'Pteropine Orthoreovirus': '#581C87',
    'Dirofilariasis': '#7C2D12',
    'Respiratory syncytial virus': '#0284C7',
    'Chronic Wasting Disease': '#365314',
    'Lyme disease': '#4D7C0F',
    'Trichophyton mentagrophytes': '#78716C',
    'Anthrax': '#450A0A',
    'Pertussis': '#1E40AF',
    'Typhoid': '#D97706',
    'Oropouche': '#C2410C',
    'Endophthalmitis': '#6B7280',
};

const DISEASE_NAMES_AR = {
    'Mpox': '\u062c\u062f\u0631\u064a \u0627\u0644\u0642\u0631\u062f\u0629',
    'Marburg': '\u0645\u0631\u0636 \u0641\u064a\u0631\u0648\u0633 \u0645\u0627\u0631\u0628\u0648\u0631\u063a',
    'MERS': '\u0645\u062a\u0644\u0627\u0632\u0645\u0629 \u0627\u0644\u0634\u0631\u0642 \u0627\u0644\u0623\u0648\u0633\u0637 \u0627\u0644\u062a\u0646\u0641\u0633\u064a\u0629',
    'Cholera': '\u0627\u0644\u0643\u0648\u0644\u064a\u0631\u0627',
    'Measles': '\u0627\u0644\u062d\u0635\u0628\u0629',
    'H5N1': '\u0625\u0646\u0641\u0644\u0648\u0646\u0632\u0627 \u0627\u0644\u0637\u064a\u0648\u0631',
    'Dengue': '\u062d\u0645\u0649 \u0627\u0644\u0636\u0646\u0643',
    'Ebola': '\u0641\u064a\u0631\u0648\u0633 \u0625\u064a\u0628\u0648\u0644\u0627',
    'COVID-19': '\u0643\u0648\u0641\u064a\u062f-19',
    'Yellow Fever': '\u0627\u0644\u062d\u0645\u0649 \u0627\u0644\u0635\u0641\u0631\u0627\u0621',
    'Polio': '\u0634\u0644\u0644 \u0627\u0644\u0623\u0637\u0641\u0627\u0644',
    'Lassa Fever': '\u062d\u0645\u0649 \u0644\u0627\u0633\u0627',
    'Malaria': '\u0627\u0644\u0645\u0644\u0627\u0631\u064a\u0627',
    'Nipah': '\u0641\u064a\u0631\u0648\u0633 \u0646\u064a\u0628\u0627\u0647',
    'Rift Valley Fever': '\u062d\u0645\u0649 \u0627\u0644\u0648\u0627\u062f\u064a \u0627\u0644\u0645\u062a\u0635\u062f\u0639',
    'Plague': '\u0627\u0644\u0637\u0627\u0639\u0648\u0646',
    'Influenza': '\u0627\u0644\u0625\u0646\u0641\u0644\u0648\u0646\u0632\u0627',
    'Zika': '\u0641\u064a\u0631\u0648\u0633 \u0632\u064a\u0643\u0627',
    'Chikungunya': '\u0634\u064a\u0643\u0648\u0646\u063a\u0648\u0646\u064a\u0627',
    'news': '\u0623\u062e\u0628\u0627\u0631',
    // --- Phase 2: additional diseases ---
    'Salmonella': '\u0627\u0644\u0633\u0627\u0644\u0645\u0648\u0646\u064a\u0644\u0627',
    'Norovirus': '\u0646\u0648\u0631\u0648\u0641\u064a\u0631\u0648\u0633',
    'Rabies': '\u062f\u0627\u0621 \u0627\u0644\u0643\u0644\u0628',
    'Hepatitis': '\u0627\u0644\u062a\u0647\u0627\u0628 \u0627\u0644\u0643\u0628\u062f',
    'Crimean-Congo Hemorrhagic Fever': '\u062d\u0645\u0649 \u0627\u0644\u0642\u0631\u0645-\u0627\u0644\u0643\u0648\u0646\u063a\u0648 \u0627\u0644\u0646\u0632\u0641\u064a\u0629',
    'Tuberculosis': '\u0627\u0644\u0633\u0644',
    'Diphtheria': '\u0627\u0644\u062f\u0641\u062a\u064a\u0631\u064a\u0627',
    'Legionellosis': '\u062f\u0627\u0621 \u0627\u0644\u0641\u064a\u0627\u0644\u0642\u0629',
    'African Swine Fever': '\u062d\u0645\u0649 \u0627\u0644\u062e\u0646\u0627\u0632\u064a\u0631 \u0627\u0644\u0623\u0641\u0631\u064a\u0642\u064a\u0629',
    'Rocky Mountain Spotted Fever': '\u062d\u0645\u0649 \u0627\u0644\u062c\u0628\u0627\u0644 \u0627\u0644\u0635\u062e\u0631\u064a\u0629 \u0627\u0644\u0645\u0628\u0642\u0639\u0629',
    'Infant Botulism': '\u062a\u0633\u0645\u0645 \u0627\u0644\u0631\u0636\u0639 \u0627\u0644\u0648\u0634\u064a\u0642\u064a',
    'Meningitis': '\u0627\u0644\u062a\u0647\u0627\u0628 \u0627\u0644\u0633\u062d\u0627\u064a\u0627',
    'Varicella': '\u0627\u0644\u062c\u062f\u0631\u064a \u0627\u0644\u0645\u0627\u0626\u064a',
    'Bacillus cereus': '\u0639\u0635\u064a\u0627\u062a \u0633\u064a\u0631\u064a\u0648\u0633',
    'Hantavirus': '\u0641\u064a\u0631\u0648\u0633 \u0647\u0627\u0646\u062a\u0627',
    'Foot and Mouth Disease': '\u0645\u0631\u0636 \u0627\u0644\u062d\u0645\u0649 \u0627\u0644\u0642\u0644\u0627\u0639\u064a\u0629',
    'E. coli': '\u0627\u0644\u0625\u0634\u0631\u064a\u0643\u064a\u0629 \u0627\u0644\u0642\u0648\u0644\u0648\u0646\u064a\u0629',
    'Leptospirosis': '\u062f\u0627\u0621 \u0627\u0644\u0628\u0631\u064a\u0645\u064a\u0627\u062a',
    'Lumpy Skin Disease': '\u0645\u0631\u0636 \u0627\u0644\u062c\u0644\u062f \u0627\u0644\u0639\u0642\u062f\u064a',
    'Rhinovirus': '\u0627\u0644\u0641\u064a\u0631\u0648\u0633 \u0627\u0644\u0623\u0646\u0641\u064a',
    'New World Screwworm': '\u0630\u0628\u0627\u0628\u0629 \u0627\u0644\u062f\u0648\u062f\u0629 \u0627\u0644\u062d\u0644\u0632\u0648\u0646\u064a\u0629',
    'Kyasanur Forest Disease': '\u0645\u0631\u0636 \u063a\u0627\u0628\u0629 \u0643\u064a\u0633\u0627\u0646\u0648\u0631',
    'Psittacosis': '\u062f\u0627\u0621 \u0627\u0644\u0628\u0628\u063a\u0627\u0621',
    'Listeriosis': '\u0627\u0644\u0644\u064a\u0633\u062a\u064a\u0631\u064a\u0627',
    'Mycobacterium abscessus complex': '\u0639\u062f\u0648\u0649 \u0627\u0644\u0645\u062a\u0641\u0637\u0631\u0629 \u0627\u0644\u062e\u0631\u0627\u062c\u064a\u0629',
    'Equine Herpesvirus': '\u0641\u064a\u0631\u0648\u0633 \u0647\u0631\u0628\u0633 \u0627\u0644\u062e\u064a\u0648\u0644',
    'Campylobacter enterocolitis': '\u0627\u0644\u062a\u0647\u0627\u0628 \u0627\u0644\u0623\u0645\u0639\u0627\u0621 \u0627\u0644\u0639\u0637\u064a\u0641\u064a',
    'Tomato Brown Rugose Fruit Virus': '\u0641\u064a\u0631\u0648\u0633 \u062a\u062c\u0639\u062f \u062b\u0645\u0627\u0631 \u0627\u0644\u0637\u0645\u0627\u0637\u0645 \u0627\u0644\u0628\u0646\u064a',
    'Tick-borne encephalitis': '\u0627\u0644\u062a\u0647\u0627\u0628 \u0627\u0644\u062f\u0645\u0627\u063a \u0627\u0644\u0645\u0646\u0642\u0648\u0644 \u0628\u0627\u0644\u0642\u0631\u0627\u062f',
    'Leprosy': '\u0627\u0644\u062c\u0630\u0627\u0645',
    'Wheat Dwarf Virus': '\u0641\u064a\u0631\u0648\u0633 \u062a\u0642\u0632\u0645 \u0627\u0644\u0642\u0645\u062d',
    'bovine respiratory disease complex': '\u0645\u0631\u0636 \u0627\u0644\u062c\u0647\u0627\u0632 \u0627\u0644\u062a\u0646\u0641\u0633\u064a \u0627\u0644\u0628\u0642\u0631\u064a',
    'Newcastle disease': '\u0645\u0631\u0636 \u0646\u064a\u0648\u0643\u0627\u0633\u0644',
    'Equine Infectious Anemia': '\u0641\u0642\u0631 \u0627\u0644\u062f\u0645 \u0627\u0644\u0645\u0639\u062f\u064a \u0627\u0644\u062e\u064a\u0644\u064a',
    'Cutibacterium acnes infection': '\u0639\u062f\u0648\u0649 \u0627\u0644\u062c\u0631\u0627\u062b\u064a\u0645 \u0627\u0644\u0628\u0631\u0648\u0628\u064a\u0648\u0646\u064a\u0629',
    'Shigellosis': '\u062f\u0627\u0621 \u0627\u0644\u0634\u064a\u063a\u064a\u0644\u0627\u062a',
    'Burkholderia stabilis': '\u0628\u0643\u062a\u064a\u0631\u064a\u0627 \u0628\u0648\u0631\u0643\u0647\u0648\u0644\u062f\u0631\u064a\u0629',
    'Pteropine Orthoreovirus': '\u0641\u064a\u0631\u0648\u0633 \u0623\u0648\u0631\u062b\u0648\u0631\u064a\u0648 \u0627\u0644\u062e\u0641\u0627\u0641\u064a\u0634',
    'Dirofilariasis': '\u062f\u0627\u0621 \u0627\u0644\u062f\u064a\u062f\u0627\u0646 \u0627\u0644\u0642\u0644\u0628\u064a\u0629',
    'Respiratory syncytial virus': '\u0627\u0644\u0641\u064a\u0631\u0648\u0633 \u0627\u0644\u0645\u062e\u0644\u0648\u064a \u0627\u0644\u062a\u0646\u0641\u0633\u064a',
    'Chronic Wasting Disease': '\u0645\u0631\u0636 \u0627\u0644\u0647\u0632\u0627\u0644 \u0627\u0644\u0645\u0632\u0645\u0646',
    'Lyme disease': '\u062f\u0627\u0621 \u0644\u0627\u064a\u0645',
    'Trichophyton mentagrophytes': '\u0641\u0637\u0631 \u0627\u0644\u0634\u0639\u0631\u0648\u064a\u0629',
    'Anthrax': '\u0627\u0644\u062c\u0645\u0631\u0629 \u0627\u0644\u062e\u0628\u064a\u062b\u0629',
    'Pertussis': '\u0627\u0644\u0633\u0639\u0627\u0644 \u0627\u0644\u062f\u064a\u0643\u064a',
    'Typhoid': '\u062d\u0645\u0649 \u0627\u0644\u062a\u064a\u0641\u0648\u0626\u064a\u062f',
    'Oropouche': '\u0641\u064a\u0631\u0648\u0633 \u0623\u0648\u0631\u0648\u0628\u0648\u062a\u0634\u064a',
    'Endophthalmitis': '\u0627\u0644\u062a\u0647\u0627\u0628 \u0628\u0627\u0637\u0646 \u0627\u0644\u0645\u0642\u0644\u0629',
};

// Icon cache for Iconify SVGs (disease -> colored data URL)
const iconCache = {};
const iconRequestPromises = {};
const FILTER_CACHE_LIMIT = 6;
const selectorCache = {
    filteredFeatures: new Map(),
    outbreakViewKey: '',
    outbreakView: null,
    countryFeaturesByCodeKey: null,
    countryFeaturesByCode: null,
    countryBriefs: new Map(),
};

function buildFallbackMarkerIcon(color) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="${color}"/></svg>`
    )}`;
}

function getDiseaseIconCacheKey(disease, color) {
    return `${disease}-${color}`;
}

function getDiseaseRemoteIconUrl(disease, color) {
    const iconName = DISEASE_ICONS[disease];
    if (!iconName) return '';
    return `https://api.iconify.design/${iconName}.svg?color=${encodeURIComponent(color)}`;
}

function scheduleDiseaseIconRefresh() {
    if (state.iconRefreshScheduled) return;
    state.iconRefreshScheduled = true;
    requestAnimationFrame(() => {
        state.iconRefreshScheduled = false;
        state.iconRefreshVersion += 1;
        if (state.mapMode !== 'travel') {
            updateDiseaseList();
            updateGlobeLayers();
        }
    });
}

// Fetch and cache SVG icon from Iconify API, colored by disease
async function getIconDataUrl(disease, color) {
    const cacheKey = getDiseaseIconCacheKey(disease, color);
    if (iconCache[cacheKey]) return iconCache[cacheKey];
    if (iconRequestPromises[cacheKey]) return iconRequestPromises[cacheKey];

    const iconName = DISEASE_ICONS[disease];
    if (!iconName) return null;

    iconRequestPromises[cacheKey] = (async () => {
        try {
            const url = getDiseaseRemoteIconUrl(disease, color);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            let svg = await response.text();
            if (!svg.includes('width=')) {
                svg = svg.replace('<svg', '<svg width="64" height="64"');
            }

            const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
            iconCache[cacheKey] = dataUrl;
            scheduleDiseaseIconRefresh();
            return dataUrl;
        } catch (e) {
            console.error(`Failed to fetch icon for ${disease}:`, e);
            return null;
        } finally {
            delete iconRequestPromises[cacheKey];
        }
    })();

    return iconRequestPromises[cacheKey];
}

function warmDiseaseIcon(disease, color) {
    const iconName = DISEASE_ICONS[disease];
    if (!iconName) return;
    const cacheKey = getDiseaseIconCacheKey(disease, color);
    if (iconCache[cacheKey] || iconRequestPromises[cacheKey]) return;
    void getIconDataUrl(disease, color);
}

function getDiseaseIconUrl(disease, color) {
    const cacheKey = getDiseaseIconCacheKey(disease, color);
    if (iconCache[cacheKey]) return iconCache[cacheKey];
    warmDiseaseIcon(disease, color);
    return getDiseaseRemoteIconUrl(disease, color) || buildFallbackMarkerIcon(color);
}

function resetOutbreakSelectorCaches() {
    selectorCache.filteredFeatures.clear();
    selectorCache.outbreakViewKey = '';
    selectorCache.outbreakView = null;
    selectorCache.countryFeaturesByCodeKey = null;
    selectorCache.countryFeaturesByCode = null;
    selectorCache.countryBriefs.clear();
}

function bumpGeoDataVersion() {
    state.geoDataVersion = (state.geoDataVersion || 0) + 1;
    resetOutbreakSelectorCaches();
}

// Fetch auto-discovered diseases from server catalog and inject into all dictionaries.
async function loadDynamicDiseases() {
    try {
        const resp = await fetch('/api/diseases');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const diseaseRows = Array.isArray(data.diseases) ? data.diseases : [];
        for (const row of diseaseRows) {
            const name = String(row?.disease || '').trim();
            if (!name || name in DISEASE_COLORS) continue;
            DISEASE_COLORS[name] = [100, 116, 139];
            DISEASE_COLORS_HEX[name] = '#64748b';
            DISEASE_ICONS[name] = 'mdi:virus-outline';
            DISEASE_NAMES_AR[name] = name;
            state.diseasesEnabled[name] = !NEWS_DISEASES.has(name);
        }
        console.log(`Loaded ${diseaseRows.length} diseases from Cloudflare D1 (${Object.keys(DISEASE_COLORS).length} total)`);
        if (diseaseRows.length && state.mapMode !== 'travel') {
            updateDiseaseList();
            updateGlobeLayers();
        }
    } catch (e) {
        console.warn('⚠️ Could not load dynamic disease catalog:', e);
    }
}

const REGION_VIEWS = {
    global:  { latitude: 20,  longitude: 10,   zoom: 1.8 },
    afro:    { latitude: 0,   longitude: 20,   zoom: 3.2 },
    amro:    { latitude: 10,  longitude: -80,  zoom: 2.8 },
    emro:    { latitude: 25,  longitude: 45,   zoom: 3.8 },
    euro:    { latitude: 50,  longitude: 15,   zoom: 3.5 },
    searo:   { latitude: 15,  longitude: 80,   zoom: 3.5 },
    wpro:    { latitude: 15,  longitude: 120,  zoom: 3.2 },
};

const I18N = {
    en: {
        logo: 'SehaRadar',
        loading: 'Loading...',
        date_to_sep: 'to',
        date_from_label: 'Start date',
        date_to_label: 'End date',
        date_reset: 'Reset date range',
        country_search_placeholder: 'Country',
        country_clear: 'Clear country',
        overview: 'Overview',
        findings: 'Findings',
        news_label: 'News',
        outbreaks_label: 'Outbreaks',
        group_all_findings: 'All Findings',
        group_outbreak_scope: 'Outbreak Scope',
        group_outbreak_risk: 'Outbreak Risk',
        countries: 'Countries',
        critical: 'Critical',
        diseases_label: 'Diseases',
        diseases_title: 'Diseases',
        filter_title: 'Filter',
        tab_diseases: 'Diseases',
        tab_news: 'News',
        risk_title: 'Risk',
        all_outbreaks: 'All outbreaks',
        risk_unclassified: 'None',
        risk_no_risk: 'No Risk',
        risk_low: 'Low',
        risk_medium: 'Medium',
        risk_high: 'High',
        risk_critical: 'Critical',
        risk_news_label: 'News',
        all: 'All',
        critical_only: 'Critical only',
        high_above: 'High & above',
        medium_above: 'Medium & above',
        mode_outbreaks: 'Outbreaks',
        mode_travel: 'Travel',
        experimental_notice: 'News is not refreshed automatically; this release is experimental.',
        travel_overview: 'Travel Overview',
        travel_tracked_countries: 'Tracked Countries',
        travel_level_meaning: 'What this level means',
        travel_why: 'Why this advisory is active',
        travel_measures: 'Traveler measures',
        travel_review: 'Review status',
        travel_last_reviewed: 'Last reviewed',
        travel_next_review: 'Next review',
        travel_click_country: 'Click a country on the map to open its travel advisory',
        travel_no_country: 'Click a country on the map to see its travel advisory',
        travel_no_measures: 'No traveler measures are currently published.',
        travel_no_advisory: 'No published advisory yet.',
        travel_updated_by: 'Updated by',
        travel_loading: 'Loading travel advisories...',
        travel_loading_detail: 'Loading advisory details...',
        travel_risk_green: 'Green',
        travel_risk_yellow: 'Yellow',
        travel_risk_red: 'Red',
        travel_risk_unknown: 'Unknown',
        travel_legend: 'Travel Risk',
        travel_health_title: 'Health Risk Overlay',
        travel_health_off: 'Country risk only',
        travel_health_all: 'All health risks',
        travel_health_loading: 'Loading health risks...',
        travel_health_empty: 'No health risk overlays are available.',
        travel_health_hint: 'Show country-level health advisories as icon overlays on top of travel risk colors.',
        alerts: 'ALERTS',
        no_alerts: 'No critical alerts at this time',
        recent_findings: 'Recent Findings',
        who_region: 'WHO Region',
        no_data: 'No data for this country',
        click_country: 'Click a country on the map to see its health brief',
        updated_ago: 'Updated {time} ago',
        just_now: 'just now',
        seconds_ago: '{n}s ago',
        minutes_ago: '{n}m ago',
        article_link: 'Article link',
        risk_assessment_label: 'Risk assessment',
        risk_assessment_placeholder: 'Add a short risk note',
        save_risk: 'Save risk',
        saving_risk: 'Saving...',
        edit_risk: 'Edit risk',
        details: 'Details',
    },
    ar: {
        logo: '\u0631\u0627\u062f\u0627\u0631 \u0635\u062d\u0629',
        loading: '\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0645\u064a\u0644...',
        date_to_sep: '\u0625\u0644\u0649',
        date_from_label: '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0628\u062f\u0627\u064a\u0629',
        date_to_label: '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0646\u0647\u0627\u064a\u0629',
        date_reset: '\u0625\u0639\u0627\u062f\u0629 \u0646\u0637\u0627\u0642 \u0627\u0644\u062a\u0627\u0631\u064a\u062e',
        country_search_placeholder: '\u0627\u0628\u062d\u062b \u0639\u0646 \u062f\u0648\u0644\u0629',
        country_clear: '\u0645\u0633\u062d \u0627\u0644\u062f\u0648\u0644\u0629',
        overview: '\u0646\u0638\u0631\u0629 \u0639\u0627\u0645\u0629',
        findings: '\u0627\u0644\u0646\u062a\u0627\u0626\u062c',
        news_label: '\u0623\u062e\u0628\u0627\u0631',
        outbreaks_label: '\u062a\u0641\u0634\u064a\u0627\u062a',
        group_all_findings: '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0646\u062a\u0627\u0626\u062c',
        group_outbreak_scope: '\u0646\u0637\u0627\u0642 \u0627\u0644\u062a\u0641\u0634\u064a\u0627\u062a',
        group_outbreak_risk: '\u0645\u062e\u0627\u0637\u0631 \u0627\u0644\u062a\u0641\u0634\u064a\u0627\u062a',
        countries: '\u0627\u0644\u062f\u0648\u0644',
        critical: '\u062d\u0631\u062c\u0629',
        diseases_label: '\u0627\u0644\u0623\u0645\u0631\u0627\u0636',
        diseases_title: '\u0627\u0644\u0623\u0645\u0631\u0627\u0636',
        filter_title: '\u062a\u0635\u0641\u064a\u0629',
        tab_diseases: '\u0627\u0644\u0623\u0645\u0631\u0627\u0636',
        tab_news: '\u0623\u062e\u0628\u0627\u0631',
        risk_title: '\u0627\u0644\u0645\u062e\u0627\u0637\u0631',
        all_outbreaks: '\u0643\u0644 \u0627\u0644\u062a\u0641\u0634\u064a\u0627\u062a',
        risk_unclassified: '\u0628\u062f\u0648\u0646',
        risk_no_risk: '\u0628\u062f\u0648\u0646 \u062e\u0637\u0631',
        risk_low: '\u0645\u0646\u062e\u0641\u0636',
        risk_medium: '\u0645\u062a\u0648\u0633\u0637',
        risk_high: '\u0639\u0627\u0644\u064a',
        risk_critical: '\u062d\u0631\u062c',
        risk_news_label: '\u0623\u062e\u0628\u0627\u0631',
        all: '\u0627\u0644\u0643\u0644',
        critical_only: '\u062d\u0631\u062c\u0629 \u0641\u0642\u0637',
        high_above: '\u0639\u0627\u0644\u064a\u0629 \u0648\u0623\u0639\u0644\u0649',
        medium_above: '\u0645\u062a\u0648\u0633\u0637\u0629 \u0648\u0623\u0639\u0644\u0649',
        mode_outbreaks: '\u0627\u0644\u0641\u0627\u0634\u064a\u0627\u062a',
        mode_travel: '\u0627\u0644\u0633\u0641\u0631',
        experimental_notice: '\u0644\u0627\u064a\u062a\u0645 \u0633\u062d\u0628 \u0627\u0644\u0627\u062e\u0628\u0627\u0631 \u0628\u0634\u0643\u0644 \u062f\u0648\u0631\u064a\u060c \u0627\u0644\u0627\u0637\u0644\u0627\u0642 \u062a\u062c\u0631\u064a\u0628\u064a.',
        travel_overview: '\u0646\u0638\u0631\u0629 \u0639\u0627\u0645\u0629 \u0644\u0644\u0633\u0641\u0631',
        travel_tracked_countries: '\u0627\u0644\u062f\u0648\u0644 \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629',
        travel_level_meaning: '\u0645\u0627\u0630\u0627 \u064a\u0639\u0646\u064a \u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062a\u0648\u0649',
        travel_why: '\u0644\u0645\u0627\u0630\u0627 \u0647\u0630\u0627 \u0627\u0644\u062a\u0646\u0628\u064a\u0647 \u0645\u0641\u0639\u0644',
        travel_measures: '\u0625\u062c\u0631\u0627\u0621\u0627\u062a \u0644\u0644\u0645\u0633\u0627\u0641\u0631\u064a\u0646',
        travel_review: '\u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0631\u0627\u062c\u0639\u0629',
        travel_last_reviewed: '\u0622\u062e\u0631 \u0645\u0631\u0627\u062c\u0639\u0629',
        travel_next_review: '\u0627\u0644\u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u0642\u0627\u062f\u0645\u0629',
        travel_click_country: '\u0627\u0646\u0642\u0631 \u0639\u0644\u0649 \u062f\u0648\u0644\u0629 \u0641\u064a \u0627\u0644\u062e\u0631\u064a\u0637\u0629 \u0644\u0641\u062a\u062d \u062a\u0646\u0628\u064a\u0647 \u0627\u0644\u0633\u0641\u0631',
        travel_no_country: '\u0627\u0646\u0642\u0631 \u0639\u0644\u0649 \u062f\u0648\u0644\u0629 \u0641\u064a \u0627\u0644\u062e\u0631\u064a\u0637\u0629 \u0644\u0639\u0631\u0636 \u062a\u0646\u0628\u064a\u0647 \u0627\u0644\u0633\u0641\u0631',
        travel_no_measures: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0625\u062c\u0631\u0627\u0621\u0627\u062a \u0645\u0646\u0634\u0648\u0631\u0629 \u062d\u0627\u0644\u064a\u0627\u064b.',
        travel_no_advisory: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u0635\u064a\u062d\u0629 \u0645\u0646\u0634\u0648\u0631\u0629 \u062d\u062a\u0649 \u0627\u0644\u0622\u0646.',
        travel_updated_by: '\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b \u0628\u0648\u0627\u0633\u0637\u0629',
        travel_loading: '\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u062a\u0646\u0628\u064a\u0647\u0627\u062a \u0627\u0644\u0633\u0641\u0631...',
        travel_loading_detail: '\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0646\u0635\u064a\u062d\u0629...',
        travel_risk_green: '\u0623\u062e\u0636\u0631',
        travel_risk_yellow: '\u0623\u0635\u0641\u0631',
        travel_risk_red: '\u0623\u062d\u0645\u0631',
        travel_risk_unknown: '\u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641',
        travel_legend: '\u0645\u062e\u0627\u0637\u0631 \u0627\u0644\u0633\u0641\u0631',
        travel_health_title: '\u0637\u0628\u0642\u0629 \u0627\u0644\u0645\u062e\u0627\u0637\u0631 \u0627\u0644\u0635\u062d\u064a\u0629',
        travel_health_off: '\u0641\u0642\u0637 \u0645\u062e\u0627\u0637\u0631 \u0627\u0644\u0633\u0641\u0631',
        travel_health_all: '\u062c\u0645\u064a\u0639 \u0627\u0644\u0645\u062e\u0627\u0637\u0631 \u0627\u0644\u0635\u062d\u064a\u0629',
        travel_health_loading: '\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0645\u062e\u0627\u0637\u0631 \u0635\u062d\u064a\u0629...',
        travel_health_empty: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0628\u0642\u0627\u062a \u0645\u062e\u0627\u0637\u0631 \u0635\u062d\u064a\u0629 \u0645\u062a\u0627\u062d\u0629.',
        travel_health_hint: '\u0623\u0638\u0647\u0631 \u0627\u0644\u062a\u0646\u0628\u064a\u0647\u0627\u062a \u0627\u0644\u0635\u062d\u064a\u0629 \u0639\u0644\u0649 \u0645\u0633\u062a\u0648\u0649 \u0627\u0644\u062f\u0648\u0644 \u0643\u0623\u064a\u0642\u0648\u0646\u0627\u062a \u0641\u0648\u0642 \u0623\u0644\u0648\u0627\u0646 \u0645\u062e\u0627\u0637\u0631 \u0627\u0644\u0633\u0641\u0631.',
        alerts: '\u062a\u0646\u0628\u064a\u0647\u0627\u062a',
        no_alerts: '\u0644\u0627 \u062a\u0648\u062c\u062f \u062a\u0646\u0628\u064a\u0647\u0627\u062a \u062d\u0631\u062c\u0629 \u0641\u064a \u0627\u0644\u0648\u0642\u062a \u0627\u0644\u062d\u0627\u0644\u064a',
        recent_findings: '\u0627\u0644\u0646\u062a\u0627\u0626\u062c \u0627\u0644\u0623\u062e\u064a\u0631\u0629',
        who_region: '\u0645\u0646\u0637\u0642\u0629 \u0645\u0646\u0638\u0645\u0629 \u0627\u0644\u0635\u062d\u0629',
        no_data: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u064a\u0627\u0646\u0627\u062a \u0644\u0647\u0630\u0627 \u0627\u0644\u0628\u0644\u062f',
        click_country: '\u0627\u0646\u0642\u0631 \u0639\u0644\u0649 \u062f\u0648\u0644\u0629 \u0639\u0644\u0649 \u0627\u0644\u062e\u0631\u064a\u0637\u0629 \u0644\u0639\u0631\u0636 \u0645\u0644\u062e\u0635\u0647\u0627 \u0627\u0644\u0635\u062d\u064a',
        updated_ago: '\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b {time}',
        just_now: '\u0627\u0644\u0622\u0646',
        seconds_ago: '\u0645\u0646\u0630 {n} \u062b\u0627\u0646\u064a\u0629',
        minutes_ago: '\u0645\u0646\u0630 {n} \u062f\u0642\u064a\u0642\u0629',
        article_link: '\u0631\u0627\u0628\u0637 \u0627\u0644\u062e\u0628\u0631',
        risk_assessment_label: '\u062a\u0642\u064a\u064a\u0645 \u0627\u0644\u0645\u062e\u0627\u0637\u0631',
        risk_assessment_placeholder: '\u0623\u0636\u0641 \u0645\u0644\u0627\u062d\u0638\u0629 \u0642\u0635\u064a\u0631\u0629 \u0639\u0646 \u0627\u0644\u0645\u062e\u0627\u0637\u0631',
        save_risk: '\u062d\u0641\u0638 \u0627\u0644\u0645\u062e\u0627\u0637\u0631',
        saving_risk: '\u062c\u0627\u0631\u064d \u0627\u0644\u062d\u0641\u0638...',
        edit_risk: '\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0645\u062e\u0627\u0637\u0631',
        details: '\u062a\u0641\u0627\u0635\u064a\u0644',
    }
};

// Country code to flag emoji
function ccToFlag(cc) {
    if (!cc || cc.length !== 2) return '';
    return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}
