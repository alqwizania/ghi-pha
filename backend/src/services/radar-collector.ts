import { surveillanceSources, sourceSnapshots, radarEvents, signals, eventScores, signalLinks, seenItems } from '../db/schema';
import { scoreEvent, shouldAutoPromote, SCORER_VERSION, type CountBasis, type DiseaseBaseline, type EpiIndicators, type ScoreResult } from './signal-scoring';
import { eq, and, gte, gt, isNull, or, sql } from 'drizzle-orm';
import { extractEvents } from './event-extractor';

// ============================================================
// COUNTRY GEOCODING LOOKUP (150+ countries → lat/lng)
// ============================================================
const COUNTRY_COORDS: Record<string, { lat: number; lng: number }> = {
  'Afghanistan': { lat: 33.93, lng: 67.71 }, 'Albania': { lat: 41.15, lng: 20.17 },
  'Algeria': { lat: 28.03, lng: 1.66 }, 'Angola': { lat: -11.20, lng: 17.87 },
  'Argentina': { lat: -38.42, lng: -63.62 }, 'Australia': { lat: -25.27, lng: 133.78 },
  'Austria': { lat: 47.52, lng: 14.55 }, 'Azerbaijan': { lat: 40.14, lng: 47.58 },
  'Bahrain': { lat: 26.07, lng: 50.56 }, 'Bangladesh': { lat: 23.68, lng: 90.36 },
  'Belgium': { lat: 50.50, lng: 4.47 }, 'Benin': { lat: 9.31, lng: 2.32 },
  'Bolivia': { lat: -16.29, lng: -63.59 }, 'Bosnia and Herzegovina': { lat: 43.92, lng: 17.68 },
  'Botswana': { lat: -22.33, lng: 24.68 }, 'Brazil': { lat: -14.24, lng: -51.93 },
  'Brunei': { lat: 4.54, lng: 114.73 }, 'Bulgaria': { lat: 42.73, lng: 25.49 },
  'Burkina Faso': { lat: 12.24, lng: -1.56 }, 'Burundi': { lat: -3.37, lng: 29.92 },
  'Cambodia': { lat: 12.57, lng: 104.99 }, 'Cameroon': { lat: 7.37, lng: 12.35 },
  'Canada': { lat: 56.13, lng: -106.35 }, 'Central African Republic': { lat: 6.61, lng: 20.94 },
  'Chad': { lat: 15.45, lng: 18.73 }, 'Chile': { lat: -35.68, lng: -71.54 },
  'China': { lat: 35.86, lng: 104.20 }, 'Colombia': { lat: 4.57, lng: -74.30 },
  'Comoros': { lat: -11.88, lng: 43.87 }, 'Congo': { lat: -0.23, lng: 15.83 },
  'Costa Rica': { lat: 9.75, lng: -83.75 }, 'Croatia': { lat: 45.10, lng: 15.20 },
  'Cuba': { lat: 21.52, lng: -77.78 }, 'Cyprus': { lat: 35.13, lng: 33.43 },
  'Czech Republic': { lat: 49.82, lng: 15.47 }, 'Czechia': { lat: 49.82, lng: 15.47 },
  'Democratic Republic of the Congo': { lat: -4.04, lng: 21.76 }, 'DRC': { lat: -4.04, lng: 21.76 },
  'Denmark': { lat: 56.26, lng: 9.50 }, 'Djibouti': { lat: 11.83, lng: 42.59 },
  'Dominican Republic': { lat: 18.74, lng: -70.16 }, 'Ecuador': { lat: -1.83, lng: -78.18 },
  'Egypt': { lat: 26.82, lng: 30.80 }, 'El Salvador': { lat: 13.79, lng: -88.90 },
  'Equatorial Guinea': { lat: 1.65, lng: 10.27 }, 'Eritrea': { lat: 15.18, lng: 39.78 },
  'Estonia': { lat: 58.60, lng: 25.01 }, 'Eswatini': { lat: -26.52, lng: 31.47 },
  'Ethiopia': { lat: 9.15, lng: 40.49 }, 'Finland': { lat: 61.92, lng: 25.75 },
  'France': { lat: 46.23, lng: 2.21 }, 'Gabon': { lat: -0.80, lng: 11.61 },
  'Gambia': { lat: 13.44, lng: -15.31 }, 'Georgia': { lat: 42.32, lng: 43.36 },
  'Germany': { lat: 51.17, lng: 10.45 }, 'Ghana': { lat: 7.95, lng: -1.02 },
  'Greece': { lat: 39.07, lng: 21.82 }, 'Guatemala': { lat: 15.78, lng: -90.23 },
  'Guinea': { lat: 9.95, lng: -9.70 }, 'Guinea-Bissau': { lat: 11.80, lng: -15.18 },
  'Haiti': { lat: 18.97, lng: -72.29 }, 'Honduras': { lat: 15.20, lng: -86.24 },
  'Hong Kong': { lat: 22.32, lng: 114.17 }, 'Hungary': { lat: 47.16, lng: 19.50 },
  'India': { lat: 20.59, lng: 78.96 }, 'Indonesia': { lat: -0.79, lng: 113.92 },
  'Iran': { lat: 32.43, lng: 53.69 }, 'Iraq': { lat: 33.22, lng: 43.68 },
  'Ireland': { lat: 53.14, lng: -7.69 }, 'Israel': { lat: 31.05, lng: 34.85 },
  'Italy': { lat: 41.87, lng: 12.57 }, 'Ivory Coast': { lat: 7.54, lng: -5.55 },
  "Côte d'Ivoire": { lat: 7.54, lng: -5.55 }, 'Jamaica': { lat: 18.11, lng: -77.30 },
  'Japan': { lat: 36.20, lng: 138.25 }, 'Jordan': { lat: 30.59, lng: 36.24 },
  'Kazakhstan': { lat: 48.02, lng: 66.92 }, 'Kenya': { lat: -0.02, lng: 37.91 },
  'Kuwait': { lat: 29.31, lng: 47.48 }, 'Kyrgyzstan': { lat: 41.20, lng: 74.77 },
  'Laos': { lat: 19.86, lng: 102.50 }, 'Latvia': { lat: 56.88, lng: 24.60 },
  'Lebanon': { lat: 33.85, lng: 35.86 }, 'Lesotho': { lat: -29.61, lng: 28.23 },
  'Liberia': { lat: 6.43, lng: -9.43 }, 'Libya': { lat: 26.34, lng: 17.23 },
  'Lithuania': { lat: 55.17, lng: 23.88 }, 'Luxembourg': { lat: 49.82, lng: 6.13 },
  'Madagascar': { lat: -18.77, lng: 46.87 }, 'Malawi': { lat: -13.25, lng: 34.30 },
  'Malaysia': { lat: 4.21, lng: 101.98 }, 'Mali': { lat: 17.57, lng: -4.00 },
  'Mauritania': { lat: 21.01, lng: -10.94 }, 'Mauritius': { lat: -20.35, lng: 57.55 },
  'Mexico': { lat: 23.63, lng: -102.55 }, 'Moldova': { lat: 47.41, lng: 28.37 },
  'Mongolia': { lat: 46.86, lng: 103.85 }, 'Morocco': { lat: 31.79, lng: -7.09 },
  'Mozambique': { lat: -18.67, lng: 35.53 }, 'Myanmar': { lat: 21.91, lng: 95.96 },
  'Namibia': { lat: -22.96, lng: 18.49 }, 'Nepal': { lat: 28.39, lng: 84.12 },
  'Netherlands': { lat: 52.13, lng: 5.29 }, 'New Zealand': { lat: -40.90, lng: 174.89 },
  'Nicaragua': { lat: 12.87, lng: -85.21 }, 'Niger': { lat: 17.61, lng: 8.08 },
  'Nigeria': { lat: 9.08, lng: 8.68 }, 'North Korea': { lat: 40.34, lng: 127.51 },
  'North Macedonia': { lat: 41.51, lng: 21.75 }, 'Norway': { lat: 60.47, lng: 8.47 },
  'Oman': { lat: 21.47, lng: 55.98 }, 'Pakistan': { lat: 30.38, lng: 69.35 },
  'Palestine': { lat: 31.95, lng: 35.23 }, 'Panama': { lat: 8.54, lng: -80.78 },
  'Papua New Guinea': { lat: -6.31, lng: 143.96 }, 'Paraguay': { lat: -23.44, lng: -58.44 },
  'Peru': { lat: -9.19, lng: -75.02 }, 'Philippines': { lat: 12.88, lng: 121.77 },
  'Poland': { lat: 51.92, lng: 19.15 }, 'Portugal': { lat: 39.40, lng: -8.22 },
  'Qatar': { lat: 25.35, lng: 51.18 }, 'Romania': { lat: 45.94, lng: 24.97 },
  'Russia': { lat: 61.52, lng: 105.32 }, 'Russian Federation': { lat: 61.52, lng: 105.32 },
  'Rwanda': { lat: -1.94, lng: 29.87 }, 'Saudi Arabia': { lat: 23.89, lng: 45.08 },
  'Senegal': { lat: 14.50, lng: -14.45 }, 'Serbia': { lat: 44.02, lng: 21.01 },
  'Sierra Leone': { lat: 8.46, lng: -11.78 }, 'Singapore': { lat: 1.35, lng: 103.82 },
  'Slovakia': { lat: 48.67, lng: 19.70 }, 'Slovenia': { lat: 46.15, lng: 14.99 },
  'Somalia': { lat: 5.15, lng: 46.20 }, 'South Africa': { lat: -30.56, lng: 22.94 },
  'South Korea': { lat: 35.91, lng: 127.77 }, 'South Sudan': { lat: 6.88, lng: 31.31 },
  'Spain': { lat: 40.46, lng: -3.75 }, 'Sri Lanka': { lat: 7.87, lng: 80.77 },
  'Sudan': { lat: 12.86, lng: 30.22 }, 'Suriname': { lat: 3.92, lng: -56.03 },
  'Sweden': { lat: 60.13, lng: 18.64 }, 'Switzerland': { lat: 46.82, lng: 8.23 },
  'Syria': { lat: 34.80, lng: 38.99 }, 'Taiwan': { lat: 23.70, lng: 120.96 },
  'Tajikistan': { lat: 38.86, lng: 71.28 }, 'Tanzania': { lat: -6.37, lng: 34.89 },
  'Thailand': { lat: 15.87, lng: 100.99 }, 'Togo': { lat: 8.62, lng: 1.21 },
  'Trinidad and Tobago': { lat: 10.69, lng: -61.22 }, 'Tunisia': { lat: 33.89, lng: 9.54 },
  'Turkey': { lat: 38.96, lng: 35.24 }, 'Türkiye': { lat: 38.96, lng: 35.24 },
  'Turkmenistan': { lat: 38.97, lng: 59.56 }, 'Uganda': { lat: 1.37, lng: 32.29 },
  'Ukraine': { lat: 48.38, lng: 31.17 }, 'United Arab Emirates': { lat: 23.42, lng: 53.85 },
  'UAE': { lat: 23.42, lng: 53.85 }, 'United Kingdom': { lat: 55.38, lng: -3.44 },
  'UK': { lat: 55.38, lng: -3.44 }, 'United States': { lat: 37.09, lng: -95.71 },
  'United States of America': { lat: 37.09, lng: -95.71 }, 'USA': { lat: 37.09, lng: -95.71 },
  'Uruguay': { lat: -32.52, lng: -55.77 }, 'Uzbekistan': { lat: 41.38, lng: 64.59 },
  'Venezuela': { lat: 6.42, lng: -66.59 }, 'Viet Nam': { lat: 14.06, lng: 108.28 },
  'Vietnam': { lat: 14.06, lng: 108.28 }, 'Yemen': { lat: 15.55, lng: 48.52 },
  'Zambia': { lat: -13.13, lng: 27.85 }, 'Zimbabwe': { lat: -19.02, lng: 29.15 },
  'Global': { lat: 20.0, lng: 0.0 }, 'Worldwide': { lat: 20.0, lng: 0.0 },
};

function geoLookup(country: string): { lat: number; lng: number } {
  if (!country) return { lat: 20, lng: 0 };
  // Direct match
  if (COUNTRY_COORDS[country]) return COUNTRY_COORDS[country];
  // Case-insensitive search
  const lower = country.toLowerCase();
  for (const [name, coords] of Object.entries(COUNTRY_COORDS)) {
    if (name.toLowerCase() === lower) return coords;
  }
  // Partial match
  for (const [name, coords] of Object.entries(COUNTRY_COORDS)) {
    if (lower.includes(name.toLowerCase()) || name.toLowerCase().includes(lower)) return coords;
  }
  return { lat: 20, lng: 0 };
}

// ============================================================
// DISEASE KEYWORD EXTRACTION
// ============================================================
const DISEASE_KEYWORDS: Record<string, string[]> = {
  'Mpox': ['mpox', 'monkeypox', 'orthopoxvirus', 'clade i', 'clade ii'],
  'Cholera': ['cholera', 'vibrio cholerae', 'acute watery diarrhea', 'awd'],
  'Measles': ['measles', 'rubeola', 'morbillivirus'],
  'Ebola': ['ebola', 'ebola virus disease', 'evd', 'filovirus'],
  'Marburg': ['marburg', 'marburg virus disease', 'mvd'],
  'MERS': ['mers', 'mers-cov', 'middle east respiratory syndrome'],
  'COVID-19': ['covid', 'sars-cov-2', 'coronavirus disease', 'covid-19'],
  'Avian Influenza': ['avian influenza', 'bird flu', 'h5n1', 'h5n6', 'h7n9', 'h5n8', 'hpai'],
  'Dengue': ['dengue', 'dengue fever', 'dengue hemorrhagic', 'denv'],
  'Yellow Fever': ['yellow fever', 'yellow fever virus'],
  'Plague': ['plague', 'yersinia pestis', 'bubonic plague', 'pneumonic plague'],
  'Polio': ['polio', 'poliovirus', 'poliomyelitis', 'cvdpv', 'wpv'],
  'Meningitis': ['meningitis', 'meningococcal', 'neisseria meningitidis'],
  'Diphtheria': ['diphtheria', 'corynebacterium diphtheriae'],
  'Influenza': ['influenza', 'flu', 'h1n1', 'h3n2', 'influenza a', 'influenza b'],
  'Malaria': ['malaria', 'plasmodium', 'falciparum'],
  'Lassa Fever': ['lassa', 'lassa fever', 'lassa virus'],
  'Rift Valley Fever': ['rift valley fever', 'rvf'],
  'Chikungunya': ['chikungunya', 'chikv'],
  'Zika': ['zika', 'zika virus', 'zikv'],
  'Hepatitis': ['hepatitis a', 'hepatitis b', 'hepatitis c', 'hepatitis e', 'acute hepatitis'],
  'Tuberculosis': ['tuberculosis', 'tb', 'mycobacterium tuberculosis'],
  'Anthrax': ['anthrax', 'bacillus anthracis'],
  'Nipah': ['nipah', 'nipah virus'],
  'Oropouche': ['oropouche', 'orov'],
};

function extractDisease(text: string): string {
  if (!text) return 'Unknown';
  const lower = text.toLowerCase();
  for (const [disease, keywords] of Object.entries(DISEASE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return disease;
    }
  }
  return 'Other Infectious Disease';
}

// ============================================================
// RISK LEVEL CLASSIFICATION
// ============================================================
function classifyRisk(text: string, cases?: number, deaths?: number): 'Critical' | 'High' | 'Moderate' | 'Low' {
  const lower = (text || '').toLowerCase();
  if (lower.includes('pheic') || lower.includes('pandemic') || lower.includes('grade 3') || lower.includes('emergency of international concern')) return 'Critical';
  if (lower.includes('death toll') || lower.includes('outbreak spreading') || lower.includes('grade 2') || lower.includes('rapidly increasing')) return 'Critical';
  if (deaths && deaths > 50) return 'Critical';
  if (cases && cases > 1000) return 'Critical';
  if (deaths && deaths > 10) return 'High';
  if (cases && cases > 100) return 'High';
  if (lower.includes('outbreak') || lower.includes('surge') || lower.includes('alert') || lower.includes('warning')) return 'High';
  if (lower.includes('cluster') || lower.includes('unusual') || lower.includes('detected')) return 'Moderate';
  return 'Moderate';
}

// ============================================================
// MASTER SOURCE REGISTRY (All 42 real sources)
// ============================================================
export const MASTER_SOURCES = [
  // Tier 1: Direct JSON APIs
  { id: 'WHO_DONS', name: 'WHO Disease Outbreak News', type: 'api', url: 'https://www.who.int/api/news/diseaseoutbreaknews', category: 'biological' },
  { id: 'WHO_MPX_API', name: 'WHO Mpox Daily Validated API', type: 'api', url: 'https://xmart-api-public.who.int/MPX/V_MPX_VALIDATED_DAILY', category: 'biological' },
  { id: 'RELIEFWEB', name: 'ReliefWeb Health & Epidemic Reports', type: 'api', url: 'https://api.reliefweb.int/v2/reports', category: 'biological' },
  // Tier 2: RSS/XML Feeds
  { id: 'PROMED', name: 'ProMED-mail Emerging Diseases', type: 'rss', url: 'https://promedmail.org/', category: 'biological' },
  { id: 'CIDRAP', name: 'CIDRAP Infectious Disease News', type: 'rss', url: 'https://www.cidrap.umn.edu/rss-feeds', category: 'biological' },
  { id: 'CDC_TRAVEL', name: 'CDC Travel Health Notices', type: 'rss', url: 'https://tools.cdc.gov/api/v2/resources/media/316422.rss', category: 'biological' },
  { id: 'WHO_NEWS', name: 'WHO News & Features RSS', type: 'rss', url: 'https://www.who.int/rss-feeds/news-english.xml', category: 'biological' },
  // Tier 3: HTML Extraction
  { id: 'WHO_AFRO', name: 'WHO AFRO Africa Disease Outbreaks', type: 'html', url: 'https://www.afro.who.int/health-topics/disease-outbreaks', category: 'biological' },
  { id: 'WHO_EMRO', name: 'WHO EMRO MERS & Outbreaks', type: 'html', url: 'https://www.emro.who.int/health-topics/mers-cov/mers-outbreaks.html', category: 'biological' },
  { id: 'ECDC', name: 'ECDC Communicable Disease Threats', type: 'html', url: 'https://www.ecdc.europa.eu/en/threats-and-outbreaks', category: 'biological' },
  { id: 'GPEI_POLIO', name: 'GPEI Polio This Week', type: 'html', url: 'https://polioeradication.org/polio-today/polio-now/this-week/', category: 'biological' },
  { id: 'PAHO', name: 'PAHO Pan American Health Outbreaks', type: 'rss', url: 'https://www.paho.org/en/rss.xml', category: 'biological' },
  // Additional registered sources (monitored via ChangeDetection.io on production server)
  { id: 'CDC', name: 'CDC Outbreaks & Surveillance', type: 'changedetection', url: 'https://www.cdc.gov/outbreaks/', category: 'biological' },
  { id: 'ECDC_CDTR', name: 'ECDC Weekly Threats Report', type: 'changedetection', url: 'https://www.ecdc.europa.eu/en/publications-data', category: 'biological' },
  { id: 'WHO_COVID_SITREP', name: 'WHO COVID-19 Situation Reports', type: 'changedetection', url: 'https://www.who.int/emergencies/diseases/novel-coronavirus-2019/situation-reports', category: 'biological' },
  { id: 'WHO_COVID_DASHBOARD', name: 'WHO COVID-19 Dashboard', type: 'changedetection', url: 'https://data.who.int/dashboards/covid19/cases', category: 'biological' },
  { id: 'WHO_RESPIRATORY', name: 'WHO Global Influenza Programme', type: 'changedetection', url: 'https://www.who.int/teams/global-influenza-programme', category: 'biological' },
  { id: 'WHO_VARIANTS', name: 'WHO SARS-CoV-2 Variants Tracking', type: 'changedetection', url: 'https://www.who.int/activities/tracking-SARS-CoV-2-variants', category: 'biological' },
  { id: 'WHO_EMRO_MERS', name: 'WHO EMRO MERS Outbreaks', type: 'changedetection', url: 'https://www.emro.who.int/health-topics/mers-cov/mers-outbreaks.html', category: 'biological' },
  { id: 'CDC_COVID', name: 'CDC COVID-19 Surveillance', type: 'changedetection', url: 'https://www.cdc.gov/covid/php/surveillance/index.html', category: 'biological' },
  { id: 'CDC_FLUVIEW', name: 'CDC FluView Influenza Surveillance', type: 'changedetection', url: 'https://www.cdc.gov/fluview/index.html', category: 'biological' },
  { id: 'CHINA_CDC', name: 'China CDC Disease Data', type: 'changedetection', url: 'https://www.chinacdc.cn/jksj/xgbdyq/', category: 'biological' },
  { id: 'HONG_KONG_CHP', name: 'Hong Kong Centre for Health Protection', type: 'changedetection', url: 'https://www.chp.gov.hk/en/index.html', category: 'biological' },
  { id: 'UK_UKHSA', name: 'UK Health Security Agency', type: 'changedetection', url: 'https://ukhsa-dashboard.data.gov.uk/', category: 'biological' },
  { id: 'GERMANY_RKI', name: 'Germany RKI Influenza Reports', type: 'changedetection', url: 'https://influenza.rki.de/Wochenberichte.aspx', category: 'biological' },
  { id: 'JAPAN_MHLW', name: 'Japan MHLW Infectious Disease Data', type: 'changedetection', url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000121431_00485.html', category: 'biological' },
  { id: 'CANADA_HEALTH', name: 'Canada Health Respiratory Surveillance', type: 'changedetection', url: 'https://health-infobase.canada.ca/respiratory-virus-surveillance/', category: 'biological' },
  { id: 'WHO_SITREP', name: 'WHO Global Situation Reports', type: 'changedetection', url: 'https://www.who.int/emergencies/situation-reports', category: 'biological' },
  { id: 'WHO_EURO', name: 'WHO EURO Emergencies', type: 'changedetection', url: 'https://www.who.int/europe/emergencies', category: 'biological' },
  { id: 'WHO_SEARO', name: 'WHO SEARO SE Asia Emergencies', type: 'changedetection', url: 'https://www.who.int/southeastasia/emergencies', category: 'biological' },
  { id: 'WHO_WPRO', name: 'WHO WPRO Western Pacific Emergencies', type: 'changedetection', url: 'https://www.who.int/westernpacific/emergencies', category: 'biological' },
  { id: 'ECDC_OUTBREAKS', name: 'ECDC Threats & Outbreaks Portal', type: 'changedetection', url: 'https://www.ecdc.europa.eu/en/threats-and-outbreaks', category: 'biological' },
  { id: 'UK_HPR', name: 'UK Health Protection Reports', type: 'changedetection', url: 'https://www.gov.uk/government/collections/health-protection-reports', category: 'biological' },
  { id: 'WHO_MPX', name: 'WHO Mpox Global Dashboard', type: 'changedetection', url: 'https://worldhealthorg.shinyapps.io/mpx_global/', category: 'biological' },
  { id: 'GTFCC_CHOLERA', name: 'GTFCC Global Cholera Trends', type: 'changedetection', url: 'https://www.gtfcc.org/about-cholera/cholera-trends/', category: 'biological' },
  { id: 'ITALY_HEALTH', name: 'Italy Ministry of Health', type: 'changedetection', url: 'https://www.salute.gov.it/', category: 'biological' },
  { id: 'NEWS_MEDICAL', name: 'News-Medical.net Health News', type: 'changedetection', url: 'https://www.news-medical.net/', category: 'biological' },
  { id: 'BEACON', name: 'Beacon Bio Intelligence', type: 'beacon', url: 'https://beacon.bio/api/feed', category: 'biological' },
];

// Rolling retrospective window. Events older than this are ignored so the
// radar always reflects the current epidemiological picture rather than a
// window that silently widens as time passes.
//
// This is a *default*, not a rule. A single global window has to be shorter
// than the fastest source's cadence to stay current, which then silently
// excludes every source that publishes less often than that. WHO EMRO issues
// its MERS update monthly: at 14 days the June update was already 34 days old
// by the time anyone looked, so the Kingdom's own MERS surveillance source
// could never land an event and reported itself as merely empty. Sources whose
// cadence exceeds the default carry `retroWindowDays` in their registry config.
const RETRO_WINDOW_DAYS = 14;

export function cutoffDate(days: number = RETRO_WINDOW_DAYS): string {
  return new Date(Date.now() - days * 86400000).toISOString().substring(0, 10);
}

/** The retrospective window for one source, honouring its registry config. */
export function cutoffForSource(source: { config?: unknown } | undefined): string {
  const configured = (source?.config as { retroWindowDays?: unknown } | undefined)?.retroWindowDays;
  const days = typeof configured === 'number' && configured > 0 ? configured : RETRO_WINDOW_DAYS;
  return cutoffDate(days);
}

// ============================================================
// PER-SOURCE DIAGNOSTICS
// ============================================================
// A source returning zero events is ambiguous: it can mean "no outbreaks
// reported" or "the upstream feed moved and we never noticed". Every fetcher
// reports which of the two happened so a dead source cannot hide as quiet.
type DiagnosticStatus = 'ok' | 'empty' | 'http_error' | 'network_error' | 'parse_error' | 'disabled';

interface SourceResult {
  sourceId: string;
  events: ParsedEvent[];
  status: DiagnosticStatus;
  detail: string;
  /** Present for model-extracted sources. Recorded so spend is visible per source. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    model?: string;
    itemsSkipped: number;
    presentedItems?: string[];
  };
}

function ok(sourceId: string, events: ParsedEvent[], totalBeforeFilter: number): SourceResult {
  if (events.length > 0) return { sourceId, events, status: 'ok', detail: `${events.length} events` };
  return {
    sourceId,
    events,
    status: 'empty',
    detail: totalBeforeFilter > 0
      ? `${totalBeforeFilter} items fetched, none newer than ${cutoffDate()}`
      : 'upstream returned no items',
  };
}

function failed(sourceId: string, status: DiagnosticStatus, detail: string): SourceResult {
  return { sourceId, events: [], status, detail };
}

// ============================================================
// SAFE FETCH WITH TIMEOUT
// ============================================================
interface FetchOutcome {
  body: string | null;
  status: DiagnosticStatus;
  detail: string;
}

async function safeFetch(url: string, timeoutMs = 8000): Promise<FetchOutcome> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GHI-PHA-Radar/1.0 (Public Health Authority, Saudi Arabia)' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { body: null, status: 'http_error', detail: `HTTP ${res.status} from ${url}` };
    }
    return { body: await res.text(), status: 'ok', detail: '' };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : (err?.message || 'unknown error');
    return { body: null, status: 'network_error', detail: `${reason} — ${url}` };
  }
}

// ============================================================
// SOURCE REGISTRY + CHANGE DETECTION
// ============================================================
// A source row drives its own retrieval: `fetchStrategy` picks the transport,
// `parserHint` picks the extractor. Adding a source is a database insert, not
// a code change.
export interface RegisteredSource {
  id: string;
  name: string;
  url: string;
  fetchStrategy: 'json' | 'rss' | 'html' | 'browser' | 'rsshub';
  parserHint: string | null;
  fetchIntervalHours: number;
  config: Record<string, any>;
}

/**
 * Strips the parts of a response that change on every request without the
 * content having changed — timestamps, cache-busting query strings, CSRF
 * tokens, session ids, and the nonce attributes most CDNs inject. Without this
 * every poll of a government portal looks like a fresh outbreak.
 */
function normalizeForHash(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?\b/g, '')
    .replace(/\b\d{2}:\d{2}:\d{2}\b/g, '')
    .replace(/(nonce|csrf[-_]?token|session[-_]?id|_?requestid|build[-_]?id)=["']?[\w-]+["']?/gi, '')
    .replace(/[?&](v|t|ts|cb|cache|_)=\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Retrieves a source's raw body. Everything except 'browser' is a plain HTTP
 * fetch; 'browser' renders the page with Cloudflare Browser Rendering for
 * sites that assemble their content client-side.
 */
async function retrieveSource(source: RegisteredSource, env?: any): Promise<FetchOutcome> {
  if (source.fetchStrategy === 'rsshub') {
    return { body: null, status: 'disabled', detail: 'RSSHub strategy requires a configured RSSHub instance' };
  }

  // Reserved for pages that only assemble their content client-side. Enabling
  // it needs three things: the `@cloudflare/puppeteer` package, a [browser]
  // binding in wrangler.toml, and Browser Rendering enabled on the account.
  // No source is registered with this strategy yet — the scan diagnostics
  // identify which ones need it (reachable, but extracting nothing).
  if (source.fetchStrategy === 'browser') {
    return {
      body: null,
      status: 'disabled',
      detail: 'Source requires JavaScript rendering; Browser Rendering is not yet enabled on this Worker',
    };
  }

  return safeFetch(source.url, 15000);
}

// ============================================================
// SIMPLE XML TAG EXTRACTOR (no external XML parser needed)
// ============================================================
function extractXmlTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
  }
  return results;
}

// ============================================================
// PARSED EVENT INTERFACE
// ============================================================
interface ParsedEvent {
  sourceId: string;
  sourceName: string;
  title: string;
  disease: string;
  country: string;
  lat: string;
  lng: string;
  dateReported: string;
  cases: number;
  deaths: number;
  cfr: string;
  summary: string;
  sourceUrl: string;
  boardType: string;
  riskLevel: string;
  /** Present only for model-extracted events; feeds deterministic scoring. */
  indicators?: EpiIndicators;
  /** What span the counts cover. Absent on legacy fetchers; treated as unknown. */
  countBasis?: CountBasis;
  countPeriod?: string | null;
}

// ============================================================
// FETCHER 1: WHO Disease Outbreak News (JSON API)
// ============================================================
function parseWHO_DONs(body: string, cutoff: string): SourceResult {
  try {
    const data = JSON.parse(body);
    const items = data.value || [];
    const events = items
      .filter((item: any) => {
        const date = (item.PublicationDate || '').substring(0, 10);
        return date >= cutoff;
      })
      .map((item: any) => {
        const title = item.Title || item.TitleText || '';
        const summary = (item.Summary || item.OverviewText || '').replace(/<[^>]*>/g, '').substring(0, 500);
        const country = item.CountryName || item.Country || extractCountryFromText(title);
        const disease = extractDisease(title + ' ' + summary);
        const coords = geoLookup(country);
        return {
          sourceId: 'WHO_DONS',
          sourceName: 'WHO Disease Outbreak News',
          title: title.substring(0, 300),
          disease,
          country,
          lat: String(coords.lat),
          lng: String(coords.lng),
          dateReported: (item.PublicationDate || '').substring(0, 10),
          cases: 0,
          deaths: 0,
          cfr: '0.00',
          summary,
          sourceUrl: item.UrlName ? `https://www.who.int/emergencies/disease-outbreak-news/${item.UrlName}` : 'https://www.who.int/emergencies/disease-outbreak-news',
          boardType: 'biological',
          riskLevel: classifyRisk(title + ' ' + summary),
        };
      });
    return ok('WHO_DONS', events, items.length);
  } catch (err: any) {
    return failed('WHO_DONS', 'parse_error', err?.message || 'JSON parse failed');
  }
}

// ============================================================
// FETCHER 2: WHO Mpox xMART API
// ============================================================
// The xMART view exposes DATE / TOTAL_CONF_DEATHS. Ordering or reading any
// other field name makes the OData endpoint reject the query with HTTP 400.
function parseWHO_Mpox(body: string, cutoff: string): SourceResult {
  try {
    const data = JSON.parse(body);
    const items = data.value || [];
    // Group by country, take latest per country
    const byCountry = new Map<string, any>();
    for (const item of items) {
      const country = item.COUNTRY || item.ADM0_NAME || '';
      if (!byCountry.has(country)) byCountry.set(country, item);
    }
    const events = Array.from(byCountry.values())
      .filter((item: any) => {
        const date = (item.DATE || '').substring(0, 10);
        return date >= cutoff;
      })
      .map((item: any) => {
        const country = item.COUNTRY || item.ADM0_NAME || 'Global';
        const coords = geoLookup(country);
        const cases = item.TOTAL_CONF_CASES || item.CASES_TOTAL || 0;
        const deaths = item.TOTAL_CONF_DEATHS || item.DEATHS_TOTAL || 0;
        return {
          sourceId: 'WHO_MPX_API',
          sourceName: 'WHO Mpox Daily Validated API',
          title: `Mpox Situation Update — ${country}`,
          disease: 'Mpox',
          country,
          lat: String(coords.lat),
          lng: String(coords.lng),
          dateReported: (item.DATE || '').substring(0, 10),
          cases,
          deaths,
          cfr: cases > 0 ? ((deaths / cases) * 100).toFixed(2) : '0.00',
          summary: `Confirmed cases: ${cases}. Deaths: ${deaths}. Data validated by WHO Mpox surveillance programme.`,
          sourceUrl: 'https://xmart-api-public.who.int/MPX/V_MPX_VALIDATED_DAILY',
          boardType: 'biological',
          riskLevel: classifyRisk('mpox outbreak', cases, deaths),
        };
      });
    return ok('WHO_MPX_API', events, byCountry.size);
  } catch (err: any) {
    return failed('WHO_MPX_API', 'parse_error', err?.message || 'JSON parse failed');
  }
}

// ============================================================
// FETCHER 3: ReliefWeb Health & Epidemic Reports API
// ============================================================
// ReliefWeb decommissioned API v1 (HTTP 410) and v2 rejects unregistered
// callers with HTTP 403. Re-enable by setting RELIEFWEB_APPNAME once PHA has
// an approved appname from https://apidoc.reliefweb.int.
export const RELIEFWEB_APPNAME = '';

function parseReliefWeb(body: string, cutoff: string): SourceResult {
  try {
    const data = JSON.parse(body);
    const items = data.data || [];
    const events = items
      .filter((item: any) => {
        const date = (item.fields?.date?.original || '').substring(0, 10);
        return date >= cutoff;
      })
      .map((item: any) => {
        const fields = item.fields || {};
        const title = fields.title || '';
        const countries = fields.country || [];
        const country = countries[0]?.name || extractCountryFromText(title);
        const coords = geoLookup(country);
        const disease = extractDisease(title);
        const summary = (fields['body-html'] || '').replace(/<[^>]*>/g, '').substring(0, 400);
        return {
          sourceId: 'RELIEFWEB',
          sourceName: 'ReliefWeb Health Reports',
          title: title.substring(0, 300),
          disease,
          country,
          lat: String(coords.lat),
          lng: String(coords.lng),
          dateReported: (fields.date?.original || '').substring(0, 10),
          cases: 0,
          deaths: 0,
          cfr: '0.00',
          summary,
          sourceUrl: fields.url || 'https://reliefweb.int',
          boardType: 'biological',
          riskLevel: classifyRisk(title + ' ' + summary),
        };
      });
    return ok('RELIEFWEB', events, items.length);
  } catch (err: any) {
    return failed('RELIEFWEB', 'parse_error', err?.message || 'JSON parse failed');
  }
}

// ============================================================
// GENERIC RSS FEED PARSER
// ============================================================
function parseRSS(sourceId: string, sourceName: string, feedUrl: string, xml: string, cutoff: string): SourceResult {
  try {
    const titles = extractXmlTags(xml, 'title');
    const links = extractXmlTags(xml, 'link');
    const descriptions = extractXmlTags(xml, 'description');
    const pubDates = extractXmlTags(xml, 'pubDate');

    const events: ParsedEvent[] = [];
    // Skip first item (channel title)
    for (let i = 1; i < Math.min(titles.length, 25); i++) {
      const title = titles[i] || '';
      if (!title || title.length < 10) continue;

      const pubDate = pubDates[i - 1] || pubDates[i] || '';
      let dateReported = '';
      try {
        const d = new Date(pubDate);
        if (!isNaN(d.getTime())) dateReported = d.toISOString().substring(0, 10);
      } catch { /* skip */ }

      if (dateReported && dateReported < cutoff) continue;
      if (!dateReported) dateReported = new Date().toISOString().substring(0, 10);

      const description = (descriptions[i] || descriptions[i - 1] || '').replace(/<[^>]*>/g, '').substring(0, 400);
      const link = links[i] || links[i - 1] || feedUrl;
      const disease = extractDisease(title + ' ' + description);
      const country = extractCountryFromText(title + ' ' + description);
      const coords = geoLookup(country);

      events.push({
        sourceId,
        sourceName,
        title: title.substring(0, 300),
        disease,
        country,
        lat: String(coords.lat),
        lng: String(coords.lng),
        dateReported,
        cases: 0,
        deaths: 0,
        cfr: '0.00',
        summary: description,
        sourceUrl: link,
        boardType: 'biological',
        riskLevel: classifyRisk(title + ' ' + description),
      });
    }
    return ok(sourceId, events, Math.max(titles.length - 1, 0));
  } catch (err: any) {
    return failed(sourceId, 'parse_error', err?.message || 'RSS parse failed');
  }
}

// ============================================================
// GENERIC HTML TITLE EXTRACTOR
// ============================================================
function parseHTMLTitles(sourceId: string, sourceName: string, pageUrl: string, html: string): SourceResult {
  try {
    // Extract article/news titles from common HTML patterns
    const patterns = [
      /<h[23][^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h[23]>/gi,
      /<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
      /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi,
      /<article[^>]*>[\s\S]*?<(?:h[234]|a)[^>]*>([\s\S]*?)<\/(?:h[234]|a)>/gi,
    ];

    const seen = new Set<string>();
    const events: ParsedEvent[] = [];
    const today = new Date().toISOString().substring(0, 10);

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null && events.length < 10) {
        const title = match[1].replace(/<[^>]*>/g, '').trim();
        if (!title || title.length < 15 || title.length > 300) continue;
        if (seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());

        const disease = extractDisease(title);
        const country = extractCountryFromText(title);
        const coords = geoLookup(country);

        events.push({
          sourceId,
          sourceName,
          title,
          disease,
          country: country || 'Global',
          lat: String(coords.lat),
          lng: String(coords.lng),
          dateReported: today,
          cases: 0,
          deaths: 0,
          cfr: '0.00',
          summary: `Headline detected from ${sourceName}: ${title}`,
          sourceUrl: pageUrl,
          boardType: 'biological',
          riskLevel: classifyRisk(title),
        });
      }
    }
    return ok(sourceId, events, events.length);
  } catch (err: any) {
    return failed(sourceId, 'parse_error', err?.message || 'HTML parse failed');
  }
}

// ============================================================
// COUNTRY EXTRACTION FROM TEXT
// ============================================================
function extractCountryFromText(text: string): string {
  if (!text) return 'Global';
  for (const country of Object.keys(COUNTRY_COORDS)) {
    if (country === 'Global' || country === 'Worldwide' || country.length < 4) continue;
    if (text.includes(country)) return country;
  }
  // Try case-insensitive
  const lower = text.toLowerCase();
  for (const country of Object.keys(COUNTRY_COORDS)) {
    if (country === 'Global' || country === 'Worldwide' || country.length < 4) continue;
    if (lower.includes(country.toLowerCase())) return country;
  }
  return 'Global';
}

// ============================================================
// INITIALIZE SOURCES IN DB
// ============================================================
export async function initializeSources(db: any) {
  if (!db) return;
  try {
    for (const src of MASTER_SOURCES) {
      await db.insert(surveillanceSources).values({
        id: src.id,
        name: src.name,
        type: src.type,
        url: src.url,
        category: src.category,
        enabled: true,
        status: 'active',
        fetchIntervalHours: 2,
      }).onConflictDoNothing();
    }
  } catch (err) {
    console.error('Error initializing sources:', err);
  }
}

// ============================================================
// PARSER DISPATCH
// ============================================================
/**
 * Structured extraction via Claude, for sources whose page layout defeats the
 * naive title scraper. Falls back to that scraper when no API key is set, so a
 * missing key degrades quality rather than breaking the scan.
 */
async function parseWithModel(
  source: RegisteredSource,
  body: string,
  apiKey: string | undefined,
  seenItems?: Set<string>
): Promise<SourceResult> {
  // Only genuine HTML goes through the text stripper. This read
  // `!== 'json'`, which sent RSS down the HTML path — so the feed handling
  // (item trimming, and now per-item skipping) only ever applied to JSON
  // sources, and CDC kept overrunning the token ceiling despite the trim
  // that was added to stop exactly that.
  const isHtml = source.fetchStrategy === 'html';
  const outcome = await extractEvents(apiKey, source, body, isHtml, seenItems);

  if (outcome.status === 'no_key') {
    const fallback = parseHTMLTitles(source.id, source.name, source.url, body);
    return { ...fallback, detail: `${fallback.detail} (model extraction unavailable: no API key)` };
  }
  if (outcome.status === 'refusal' || outcome.status === 'error') {
    return failed(source.id, 'parse_error', outcome.detail);
  }

  // The source's own window, not the global default. Filtering here with the
  // 14-day default discarded WHO EMRO's monthly MERS update before it could be
  // counted, so the source reported `empty` — indistinguishable from "no
  // outbreaks" — while its page carried the Kingdom's MERS figures the whole
  // time. Every layer that drops an event has to use the same window.
  const cutoff = cutoffForSource(source);
  const today = new Date().toISOString().substring(0, 10);
  const events: ParsedEvent[] = [];

  for (const e of outcome.events) {
    const dateReported = e.dateReported || today;
    if (dateReported < cutoff) continue;

    const country = e.country || 'Global';
    const coords = geoLookup(country);
    const cases = e.cases ?? 0;
    const deaths = e.deaths ?? 0;

    events.push({
      sourceId: source.id,
      sourceName: source.name,
      title: (e.title || '').substring(0, 300),
      disease: e.disease || 'Unspecified',
      country,
      lat: String(coords.lat),
      lng: String(coords.lng),
      dateReported,
      cases,
      deaths,
      cfr: cases > 0 ? ((deaths / cases) * 100).toFixed(2) : '0.00',
      summary: (e.summary || '').substring(0, 400),
      sourceUrl: e.url || source.url,
      boardType: 'biological',
      // Severity stays in deterministic code so an escalation can be explained
      // without appealing to the model's judgement.
      riskLevel: classifyRisk(`${e.title} ${e.summary}`, cases, deaths),
      indicators: e.indicators,
      countBasis: e.countBasis ?? 'unknown',
      countPeriod: e.countPeriod ? e.countPeriod.substring(0, 80) : null,
    });
  }

  return {
    ...ok(source.id, events, outcome.events.length),
    usage: {
      inputTokens: outcome.inputTokens ?? 0,
      outputTokens: outcome.outputTokens ?? 0,
      model: outcome.model,
      itemsSkipped: outcome.itemsSkipped ?? 0,
      presentedItems: outcome.presentedItems,
    },
  };
}

async function parseSource(
  source: RegisteredSource,
  body: string,
  apiKey: string | undefined,
  seenItems?: Set<string>
): Promise<SourceResult> {
  // Every parser drops events outside the window, so they all need the source's
  // own window rather than the global default.
  const cutoff = cutoffForSource(source);
  switch (source.parserHint) {
    case 'ai':
      return parseWithModel(source, body, apiKey, seenItems);
    case 'who_dons':
      return parseWHO_DONs(body, cutoff);
    case 'who_mpox':
      return parseWHO_Mpox(body, cutoff);
    case 'reliefweb':
      return parseReliefWeb(body, cutoff);
    case 'rss':
      return parseRSS(source.id, source.name, source.url, body, cutoff);
    default:
      // Anything registered without a specific extractor is treated as a page
      // of headlines. This is a deliberately weak default — it is what the
      // structured-extraction phase replaces.
      return source.fetchStrategy === 'rss'
        ? parseRSS(source.id, source.name, source.url, body, cutoff)
        : parseHTMLTitles(source.id, source.name, source.url, body);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Runs one task per source with bounded concurrency, but never two against the
 * same host at once — four concurrent requests to cdc.gov got the whole scan
 * rate-limited with 403s, while the same requests spaced out succeed. Different
 * hosts still run in parallel, so the scan stays fast.
 */
async function mapByHost<T extends { url: string }, R>(
  items: T[],
  hostLimit: number,
  perHostDelayMs: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const byHost = new Map<string, { item: T; index: number }[]>();
  items.forEach((item, index) => {
    const host = hostOf(item.url);
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host)!.push({ item, index });
  });

  const results: R[] = new Array(items.length);
  const groups = [...byHost.values()];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(hostLimit, groups.length) }, async () => {
    while (cursor < groups.length) {
      const group = groups[cursor++];
      for (let i = 0; i < group.length; i++) {
        if (i > 0 && perHostDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, perHostDelayMs));
        }
        results[group[i].index] = await fn(group[i].item);
      }
    }
  });

  await Promise.all(workers);
  return results;
}

// ============================================================
// MAIN SCAN: REGISTRY-DRIVEN, HASH-GATED
// ============================================================
// Sources come from the database, not from a hardcoded list. Each is fetched,
// normalized, and hashed; extraction only runs when the hash moved since the
// last scan. That gating is what makes a 40-source registry affordable and is
// the reason no self-hosted change-detection service is needed.
export async function fetchGlobalRadarScan(db?: any, env?: any, options: { force?: boolean } = {}) {
  const cutoff = cutoffDate();
  const allEvents: ParsedEvent[] = [];
  const sourceStats: Record<string, number> = {};
  const diagnostics: Record<string, string> = {};
  const degraded: string[] = [];
  let checkedCount = 0;
  let unchangedCount = 0;

  if (!db) {
    return {
      status: 'error', count: 0, inserted: 0, skippedDuplicates: 0,
      checked: 0, unchanged: 0, cutoffDate: cutoff,
      sources: sourceStats, degraded: ['DATABASE'],
      diagnostics: { DATABASE: 'No database connection; the source registry could not be read' },
    };
  }

  const registered = await db.query.surveillanceSources.findMany({
    where: eq(surveillanceSources.enabled, true),
  });

  const snapshotRows = await db.query.sourceSnapshots.findMany();
  const snapshots = new Map<string, any>(snapshotRows.map((s: any) => [s.sourceId, s]));

  // A monthly source needs a longer memory than a daily one. See cutoffForSource.
  const cutoffs = new Map<string, string>(
    registered.map((s: any) => [s.id, cutoffForSource(s)])
  );

  // Feed entries already put in front of the model. This is what turns "the
  // page changed, re-read all forty items" into "re-read the two that are new".
  const seenBySource = new Map<string, Set<string>>();
  try {
    const rows = await db.select().from(seenItems);
    for (const row of rows as Array<{ sourceId: string; itemKey: string }>) {
      let set = seenBySource.get(row.sourceId);
      if (!set) { set = new Set(); seenBySource.set(row.sourceId, set); }
      set.add(row.itemKey);
    }
  } catch (err) {
    // Losing this costs money, not correctness — every item is simply re-read.
    console.error('[GHI Radar] Could not load seen items; extracting everything:', err);
  }

  const now = Date.now();
  const due = registered.filter((s: any) => {
    if (options.force) return true;
    const snap = snapshots.get(s.id);
    if (!snap?.lastFetchedAt) return true;
    const intervalMs = Math.max(1, s.fetchIntervalHours ?? 6) * 3600_000;
    return now - new Date(snap.lastFetchedAt).getTime() >= intervalMs;
  });

  console.log(`[GHI Radar] ${registered.length} enabled sources, ${due.length} due this pass`);

  const outcomes = await mapByHost(due, 10, 1200, async (source: any) => {
    const spec: RegisteredSource = {
      id: source.id,
      name: source.name,
      url: source.url,
      fetchStrategy: source.fetchStrategy,
      parserHint: source.parserHint,
      fetchIntervalHours: source.fetchIntervalHours ?? 6,
      config: source.config ?? {},
    };
    const snap = snapshots.get(spec.id);
    const fetchedAt = new Date();

    const retrieved = await retrieveSource(spec, env);
    if (!retrieved.body) {
      return {
        spec, fetchedAt, changed: false, hash: snap?.contentHash ?? null, bytes: 0,
        result: failed(spec.id, retrieved.status, retrieved.detail),
      };
    }

    const hash = await sha256(normalizeForHash(retrieved.body));
    const changed = hash !== snap?.contentHash;

    if (!changed) {
      return {
        spec, fetchedAt, changed: false, hash, bytes: retrieved.body.length,
        result: { sourceId: spec.id, events: [], status: 'ok' as DiagnosticStatus, detail: 'unchanged since last scan' },
      };
    }

    return {
      spec, fetchedAt, changed: true, hash, bytes: retrieved.body.length,
      result: await parseSource(spec, retrieved.body, env?.ANTHROPIC_API_KEY, seenBySource.get(spec.id)),
    };
  });

  for (const outcome of outcomes) {
    const { spec, result, changed } = outcome;
    checkedCount++;
    if (!changed && result.status === 'ok') unchangedCount++;

    sourceStats[spec.id] = (sourceStats[spec.id] || 0) + result.events.length;
    allEvents.push(...result.events);

    if (result.status !== 'ok' && result.status !== 'empty') {
      diagnostics[spec.id] = `${result.status}: ${result.detail}`;
      if (!degraded.includes(spec.id)) degraded.push(spec.id);
    } else if (result.status === 'empty' && !diagnostics[spec.id]) {
      diagnostics[spec.id] = `empty: ${result.detail}`;
    }
  }

  for (const sourceId of Object.keys(diagnostics)) {
    if (sourceStats[sourceId] > 0 && diagnostics[sourceId].startsWith('empty:')) {
      delete diagnostics[sourceId];
    }
  }

  const liveSources = Object.keys(sourceStats).filter((s) => sourceStats[s] > 0);
  console.log(
    `[GHI Radar] checked ${checkedCount}, ${unchangedCount} unchanged, ` +
    `${allEvents.length} events from ${liveSources.length} sources`
  );
  if (degraded.length > 0) {
    console.error(`[GHI Radar] ${degraded.length} source(s) DEGRADED:`,
      degraded.map((s) => `${s} (${diagnostics[s]})`).join(' | '));
  }

  // Insert into database with deduplication.
  // radar_events has no natural unique constraint (its primary key is a random
  // uuid), so onConflictDoNothing can never fire and every scan would re-insert
  // the same headlines. Dedupe on source + title against what is already stored
  // in the current window, and within this batch, before writing.
  let insertedCount = 0;
  let skippedCount = 0;

  if (db && allEvents.length > 0) {
    let inserted = 0;
    let skipped = 0;
    const dedupeKey = (sourceId: string, title: string) => `${sourceId}::${title.trim().toLowerCase()}`;
    const seen = new Set<string>();

    // `seen` deduplicates within this scan only. It used to be pre-loaded with
    // everything already in the window, which meant an event the database
    // already held was skipped before it reached the insert — so the upsert
    // that exists to absorb revised figures could never fire for the case it
    // was written for. The database's unique index is the durable guard; this
    // set only stops one scan from fighting itself.
    for (const evt of allEvents) {
      try {
        const key = dedupeKey(evt.sourceId, evt.title);
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);

        if (evt.dateReported >= (cutoffs.get(evt.sourceId) ?? cutoff)) {
          await db.insert(radarEvents).values({
            sourceId: evt.sourceId,
            sourceName: evt.sourceName,
            title: evt.title,
            disease: evt.disease,
            country: evt.country,
            lat: evt.lat,
            lng: evt.lng,
            dateReported: evt.dateReported,
            cases: evt.cases,
            deaths: evt.deaths,
            cfr: evt.cfr,
            countBasis: evt.countBasis ?? 'unknown',
            countPeriod: evt.countPeriod ?? null,
            indicators: evt.indicators ?? null,
            summary: evt.summary,
            sourceUrl: evt.sourceUrl,
            boardType: evt.boardType,
            riskLevel: evt.riskLevel,
            isPromoted: false
          }).onConflictDoUpdate({
            // Sources republish the same headline with revised figures — WHO's
            // MERS page carries one title and a new total every month. Ignoring
            // the conflict meant every such update was discarded and the event
            // stayed frozen at whatever the first scan happened to catch.
            //
            // Promotion state is deliberately absent from the set: an event
            // already in triage stays in triage, and re-reporting must not
            // resurrect something an analyst has dealt with.
            target: radarEvents.contentHash,
            set: {
              cases: evt.cases,
              deaths: evt.deaths,
              cfr: evt.cfr,
              dateReported: evt.dateReported,
              summary: evt.summary,
              riskLevel: evt.riskLevel,
              countBasis: evt.countBasis ?? 'unknown',
              countPeriod: evt.countPeriod ?? null,
              indicators: evt.indicators ?? null,
              sourceUrl: evt.sourceUrl,
              updatedAt: new Date(),
            },
            // Only touch the row when something actually moved. Without this
            // every scan would rewrite every event, bump updated_at, and send
            // the whole corpus back through scoring on each pass.
            setWhere: sql`
              radar_events.cases        IS DISTINCT FROM excluded.cases
              OR radar_events.deaths       IS DISTINCT FROM excluded.deaths
              OR radar_events.summary      IS DISTINCT FROM excluded.summary
              OR radar_events.count_basis  IS DISTINCT FROM excluded.count_basis
              OR radar_events.count_period IS DISTINCT FROM excluded.count_period
              OR radar_events.indicators   IS DISTINCT FROM excluded.indicators
            `,
          });
          inserted++;
        }
      } catch (err) {
        console.error(`[GHI Radar] Insert failed for "${evt.title.substring(0, 80)}":`, err);
      }
    }
    console.log(`[GHI Radar] Inserted ${inserted} new events, skipped ${skipped} already-seen`);
    insertedCount = inserted;
    skippedCount = skipped;
  }

  // Score everything unscored and promote what clears the IHR threshold.
  // Runs after insertion so newly written events are picked up in the same
  // pass, and covers any backlog left by an earlier failure.
  let scoredCount = 0;
  let promotedCount = 0;
  if (db) {
    try {
      const result = await scoreAndPromotePending(db);
      scoredCount = result.scored;
      promotedCount = result.promoted;
    } catch (err) {
      console.error('[GHI Radar] Scoring pass failed:', err);
    }
  }

  // Record what happened to each source. This is both the change-detection
  // state for the next scan and the health data the sources drawer reads, so
  // it survives beyond the lifetime of a single scan response.
  for (const outcome of outcomes) {
    const { spec, fetchedAt, changed, hash, bytes, result } = outcome;
    const healthy = result.status === 'ok' || result.status === 'empty';
    const prior = snapshots.get(spec.id);

    // Only a successful pass may claim this content as seen.
    //
    // The hash is the change-detection state: storing it after a failed
    // extraction tells the next scan "already handled", and the source then
    // stays silent until its page happens to change. CDC failed once on a
    // truncated response and was skipped on every subsequent scan, including
    // forced ones, while reporting itself as merely unchanged. A failure must
    // leave the previous hash in place so the next pass retries.
    const hashToStore = healthy ? hash : prior?.contentHash ?? null;

    try {
      await db.insert(sourceSnapshots).values({
        sourceId: spec.id,
        contentHash: hashToStore,
        contentBytes: bytes,
        lastFetchedAt: fetchedAt,
        lastSuccessAt: healthy ? fetchedAt : prior?.lastSuccessAt ?? null,
        lastChangedAt: changed ? fetchedAt : prior?.lastChangedAt ?? null,
        lastStatus: result.status,
        lastError: healthy ? null : result.detail,
        consecutiveFailures: healthy ? 0 : (prior?.consecutiveFailures ?? 0) + 1,
        eventsLastExtracted: result.events.length,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        extractionModel: result.usage?.model ?? null,
        itemsSkipped: result.usage?.itemsSkipped ?? 0,
        updatedAt: fetchedAt,
      }).onConflictDoUpdate({
        target: sourceSnapshots.sourceId,
        set: {
          contentHash: hashToStore,
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          extractionModel: result.usage?.model ?? null,
          itemsSkipped: result.usage?.itemsSkipped ?? 0,
          contentBytes: bytes,
          lastFetchedAt: fetchedAt,
          lastSuccessAt: healthy ? fetchedAt : prior?.lastSuccessAt ?? null,
          lastChangedAt: changed ? fetchedAt : prior?.lastChangedAt ?? null,
          lastStatus: result.status,
          lastError: healthy ? null : result.detail,
          consecutiveFailures: healthy ? 0 : (prior?.consecutiveFailures ?? 0) + 1,
          eventsLastExtracted: result.events.length,
          updatedAt: fetchedAt,
        },
      });
    } catch (err) {
      console.error(`[GHI Radar] Snapshot write failed for ${spec.id}:`, err);
    }

    // Record what the model actually saw, so it is never paid for twice. Only
    // after a successful pass: a failed extraction has not read anything.
    const presented = result.usage?.presentedItems;
    if (healthy && presented?.length) {
      try {
        await db.insert(seenItems)
          .values(presented.map((itemKey) => ({ sourceId: spec.id, itemKey })))
          .onConflictDoNothing();
      } catch (err) {
        console.error(`[GHI Radar] Could not record seen items for ${spec.id}:`, err);
      }
    }
  }

  // Sources configured for structured extraction silently fall back to the
  // legacy title scraper when no key is present. That is a quality difference
  // the operator should see, not a silent downgrade.
  const wantsModel = due.filter((s: any) => s.parserHint === 'ai').map((s: any) => s.id);
  const extraction = !env?.ANTHROPIC_API_KEY && wantsModel.length > 0
    ? {
        mode: 'fallback' as const,
        detail: 'ANTHROPIC_API_KEY is not configured; these sources used the legacy title extractor',
        affected: wantsModel,
      }
    : { mode: wantsModel.length > 0 ? ('structured' as const) : ('legacy' as const), detail: '', affected: wantsModel };

  return {
    status: degraded.length > 0 ? 'degraded' : 'success',
    count: allEvents.length,
    inserted: insertedCount,
    skippedDuplicates: skippedCount,
    checked: checkedCount,
    unchanged: unchangedCount,
    cutoffDate: cutoff,
    sources: sourceStats,
    degraded,
    diagnostics,
    extraction,
    scored: scoredCount,
    promoted: promotedCount,
  };
}

// ============================================================
// SCORING + AUTO-PROMOTION
// ============================================================
/**
 * Scores every radar event that has no score yet and promotes the ones
 * clearing the IHR two-domain rule into the triage queue.
 *
 * Promotion is what closes the gap between the radar and triage: previously an
 * event only reached an analyst if someone spotted it on a map and pressed a
 * button, which happened twice in the system's history.
 */
export async function scoreAndPromotePending(
  db: any,
  limit = 400
): Promise<{ scored: number; promoted: number; corroborated: number }> {
  // Promotion honours each source's own window, so a monthly source's event is
  // not scored and then dropped on its way to triage.
  const sourceRows = await db.query.surveillanceSources.findMany();
  const cutoffs = new Map<string, string>(sourceRows.map((s: any) => [s.id, cutoffForSource(s)]));
  const credibility = new Map<string, number>(
    sourceRows.map((s: any) => [s.id, s.credibilityScore ?? 70])
  );

  // How many *distinct* sources report the same disease in the same country.
  // Independent agreement is the strongest evidence event-based surveillance
  // produces; until now it was used only to suppress duplicate triage rows and
  // never to raise confidence in the event itself.
  const corroboration = new Map<string, number>();
  try {
    const agreement = await db
      .select({
        disease: radarEvents.disease,
        country: radarEvents.country,
        sources: sql<number>`count(distinct ${radarEvents.sourceId})::int`,
      })
      .from(radarEvents)
      .where(gte(radarEvents.dateReported, cutoffDate(30)))
      .groupBy(radarEvents.disease, radarEvents.country);
    for (const row of agreement) {
      corroboration.set(`${row.disease}::${row.country}`.toLowerCase(), Number(row.sources));
    }
  } catch (err) {
    console.error('[GHI Scoring] Could not compute corroboration; treating events as single-source:', err);
  }
  const cutoff = cutoffDate();
  const widestCutoff = [...cutoffs.values(), cutoff].sort()[0];

  const baselineRows = await db.query.diseaseBaselines.findMany();
  const baselines: DiseaseBaseline[] = baselineRows.map((b: any) => ({
    disease: b.disease,
    country: b.country,
    endemicStatus: b.endemicStatus,
    expectedAnnualCases: b.expectedAnnualCases,
    baselineCfr: b.baselineCfr === null ? null : Number(b.baselineCfr),
    transmissionRoute: b.transmissionRoute,
    ihrNotifiable: b.ihrNotifiable,
    ihrAssessAlways: b.ihrAssessAlways,
  }));

  // Unscored events, plus events a re-report has revised since they were last
  // scored. Without the second clause an outbreak's score would be frozen at
  // whatever the first scan caught, however far the figures moved afterwards.
  const pending = await db
    .select()
    .from(radarEvents)
    .leftJoin(eventScores, eq(eventScores.radarEventId, radarEvents.id))
    .where(or(
      isNull(eventScores.radarEventId),
      gt(radarEvents.updatedAt, eventScores.scoredAt)
    ))
    .limit(limit);

  let scored = 0;
  let corroborated = 0;
  let promoted = 0;

  for (const row of pending) {
    const evt = row.radar_events ?? row;
    try {
      const result = scoreEvent(
        {
          disease: evt.disease,
          country: evt.country,
          cases: evt.cases,
          deaths: evt.deaths,
          title: evt.title,
          summary: evt.summary ?? '',
          dateReported: evt.dateReported,
          sourceId: evt.sourceId ?? '',
          // Read back from the row rather than carried in memory: scoring runs
          // as its own pass over unscored events, so anything the extractor
          // found has to survive the insert to reach it. Before migration 015
          // it did not, and every indicator rule was dead.
          indicators: (evt.indicators ?? undefined) as EpiIndicators | undefined,
          countBasis: (evt.countBasis ?? 'unknown') as CountBasis,
          countPeriod: evt.countPeriod,
          credibility: credibility.get(evt.sourceId ?? '') ?? 70,
          // Minus one: the event's own source is not corroboration of itself.
          corroboratingSources: Math.max(
            0,
            (corroboration.get(`${evt.disease}::${evt.country}`.toLowerCase()) ?? 1) - 1
          ),
        },
        baselines
      );

      await db.insert(eventScores).values({
        radarEventId: evt.id,
        severity: result.severity.score,
        unusualness: result.unusualness.score,
        spread: result.spread.score,
        tradeTravel: result.tradeTravel.score,
        ksaRelevance: result.ksaRelevance.score,
        domainsAtTwo: result.domainsAtTwo,
        tier: result.tier,
        mandatoryIhr: result.mandatoryIhr,
        confidence: result.confidence,
        reportsOccurrence: result.reportsOccurrence,
        credibility: result.confidenceDetail?.credibility ?? 70,
        corroboration: result.confidenceDetail?.corroboration ?? 0,
        confidenceScore: result.confidenceDetail?.score ?? 0,
        evidence: {
          severity: result.severity.reasons,
          unusualness: result.unusualness.reasons,
          spread: result.spread.reasons,
          tradeTravel: result.tradeTravel.reasons,
          ksaRelevance: result.ksaRelevance.reasons,
        },
        scorerVersion: SCORER_VERSION,
      }).onConflictDoUpdate({
        // A re-scored event replaces its score rather than keeping the stale
        // one. The evidence goes with it, so what an analyst reads always
        // matches the figures the event currently holds.
        target: eventScores.radarEventId,
        set: {
          severity: result.severity.score,
          unusualness: result.unusualness.score,
          spread: result.spread.score,
          tradeTravel: result.tradeTravel.score,
          ksaRelevance: result.ksaRelevance.score,
          domainsAtTwo: result.domainsAtTwo,
          tier: result.tier,
          mandatoryIhr: result.mandatoryIhr,
          confidence: result.confidence,
          reportsOccurrence: result.reportsOccurrence,
          credibility: result.confidenceDetail?.credibility ?? 70,
          corroboration: result.confidenceDetail?.corroboration ?? 0,
          confidenceScore: result.confidenceDetail?.score ?? 0,
          evidence: {
            severity: result.severity.reasons,
            unusualness: result.unusualness.reasons,
            spread: result.spread.reasons,
            tradeTravel: result.tradeTravel.reasons,
            ksaRelevance: result.ksaRelevance.reasons,
          },
          scorerVersion: SCORER_VERSION,
          scoredAt: new Date(),
        },
      });
      scored++;

      if (shouldAutoPromote(result)) {
        promoted += await promoteScoredEvent(db, evt, result, cutoffs.get(evt.sourceId ?? '') ?? cutoff);
      }
    } catch (err) {
      console.error(`[GHI Scoring] Failed on event ${evt.id}:`, err);
    }
  }

  // Promotion is a separate pass over everything already scored but not yet in
  // triage. Scoring and promotion can fail independently — without this an
  // event that scored during a run that then failed would never reach an
  // analyst, and a backfill that only writes scores would strand its results.
  try {
    const stranded = await db
      .select()
      .from(eventScores)
      .innerJoin(radarEvents, eq(radarEvents.id, eventScores.radarEventId))
      .where(and(
        eq(radarEvents.isPromoted, false),
        // Widest configured window; each event is then held to its own below.
        gte(radarEvents.dateReported, widestCutoff)
      ))
      .limit(limit);

    for (const row of stranded) {
      const evt = row.radar_events;
      const s = row.event_scores;
      if (evt.dateReported < (cutoffs.get(evt.sourceId ?? '') ?? cutoff)) continue;
      if (!(s.mandatoryIhr || s.tier === 'critical' || s.tier === 'high') || s.confidence === 'low') continue;

      const evidence = (s.evidence ?? {}) as Record<string, string[]>;
      promoted += await promoteScoredEvent(
        db,
        evt,
        {
          severity: { score: s.severity as 0 | 1 | 2 | 3, reasons: evidence.severity ?? [] },
          unusualness: { score: s.unusualness as 0 | 1 | 2 | 3, reasons: evidence.unusualness ?? [] },
          spread: { score: s.spread as 0 | 1 | 2 | 3, reasons: evidence.spread ?? [] },
          tradeTravel: { score: s.tradeTravel as 0 | 1 | 2 | 3, reasons: evidence.tradeTravel ?? [] },
          ksaRelevance: { score: s.ksaRelevance as 0 | 1 | 2 | 3, reasons: evidence.ksaRelevance ?? [] },
          domainsAtTwo: s.domainsAtTwo,
          tier: s.tier as ScoreResult['tier'],
          mandatoryIhr: s.mandatoryIhr,
          confidence: s.confidence as ScoreResult['confidence'],
          reportsOccurrence: s.reportsOccurrence,
        },
        cutoff
      );
    }
  } catch (err) {
    console.error('[GHI Scoring] Promotion pass failed:', err);
  }

  if (scored > 0 || promoted > 0 || corroborated > 0) {
    console.log(`[GHI Scoring] scored ${scored}, promoted ${promoted}, corroborated ${corroborated} into existing signals`);
  }
  return { scored, promoted, corroborated };

  /** Creates a triage signal, or records corroboration against an existing one. */
  async function promoteScoredEvent(db: any, evt: any, result: ScoreResult, cutoff: string): Promise<number> {
    try {
        // WHO, ECDC and CIDRAP all report the same outbreak, so promoting per
        // event would put one outbreak into triage three times. An existing
        // open signal for the same disease and country within the window is
        // the same event: record corroboration against it instead. Independent
        // agreement raises confidence, it is not a second outbreak.
        const [existing] = await db
          .select({ id: signals.id })
          .from(signals)
          .where(and(
            eq(signals.disease, evt.disease),
            eq(signals.country, evt.country),
            eq(signals.triageStatus, 'Pending Triage'),
            gte(signals.dateReported, cutoff)
          ))
          .limit(1);

        if (existing) {
          await db.insert(signalLinks).values({
            fromType: 'radar_event',
            fromId: evt.id,
            toType: 'signal',
            toId: existing.id,
            linkType: 'corroborates',
            confidence: '0.80',
            rationale: `${evt.sourceName} reports the same ${evt.disease} event in ${evt.country}`,
          }).onConflictDoNothing();

          await db.update(radarEvents)
            .set({ isPromoted: true, promotedSignalId: existing.id })
            .where(eq(radarEvents.id, evt.id));
          corroborated++;
          return 0;
        }

        const [signal] = await db.insert(signals).values({
          disease: evt.disease,
          country: evt.country,
          location: evt.country,
          dateReported: evt.dateReported,
          cases: evt.cases ?? 0,
          deaths: evt.deaths ?? 0,
          caseFatalityRate: evt.cfr,
          description: evt.summary,
          sourceUrl: evt.sourceUrl,
          sourceName: evt.sourceName,
          sourceOrigin: 'radar',
          boardType: evt.boardType ?? 'biological',
          gccRelevant: result.ksaRelevance.score >= 2,
          saudiRiskLevel: result.tier === 'critical' ? 'Critical' : result.tier === 'high' ? 'High' : 'Moderate',
          // The score and its evidence travel with the signal, so triage can
          // show why an item arrived without recomputing anything.
          rawData: {
            radarEventId: evt.id,
            score: {
              tier: result.tier,
              domainsAtTwo: result.domainsAtTwo,
              mandatoryIhr: result.mandatoryIhr,
              confidence: result.confidence,
              severity: result.severity,
              unusualness: result.unusualness,
              spread: result.spread,
              tradeTravel: result.tradeTravel,
              ksaRelevance: result.ksaRelevance,
            },
          },
          priorityScore: Math.round(
            ((result.severity.score + result.unusualness.score + result.spread.score +
              result.tradeTravel.score + result.ksaRelevance.score) / 15) * 100
          ),
          triageStatus: 'Pending Triage',
          currentStatus: 'Awaiting Triage',
          sourceStream: 'radar',
          radarEventId: evt.id,
          autoPromoted: true,
        }).returning();

        if (signal) {
          await db.update(radarEvents)
            .set({ isPromoted: true, promotedSignalId: signal.id })
            .where(eq(radarEvents.id, evt.id));
          return 1;
        }
        return 0;
    } catch (err) {
      console.error(`[GHI Scoring] Promotion failed for event ${evt.id}:`, err);
      return 0;
    }
  }
}

// ============================================================
// PROMOTE RADAR EVENT → TRIAGE SIGNAL
// ============================================================
export async function promoteRadarEventToSignal(db: any, eventId: string) {
  if (!db) throw new Error('Database connection required');

  const [event] = await db.select().from(radarEvents).where(eq(radarEvents.id, eventId));
  if (!event) throw new Error('Radar event not found');

  const now = new Date();
  const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [newSignal] = await db.insert(signals).values({
    sourceUrl: event.sourceUrl,
    sourceOrigin: 'radar',
    sourceName: event.sourceName,
    boardType: event.boardType,
    rawData: event,
    disease: event.disease,
    country: event.country,
    dateReported: event.dateReported,
    cases: event.cases || 0,
    deaths: event.deaths || 0,
    caseFatalityRate: event.cfr ? String(event.cfr) : '0.00',
    description: event.summary,
    triageStatus: 'Pending Triage',
    priorityScore: event.riskLevel === 'Critical' ? '90.00' : '75.00',
    gccRelevant: ['Saudi Arabia', 'Yemen', 'Oman', 'UAE', 'United Arab Emirates', 'Qatar', 'Bahrain', 'Kuwait', 'Iraq', 'Jordan', 'Egypt', 'Sudan', 'Somalia', 'Djibouti', 'Lebanon', 'Syria', 'Iran', 'Pakistan', 'Afghanistan'].includes(event.country),
    saudiRiskLevel: event.riskLevel,
    currentStatus: 'New',
    verificationStatus: 'Unverified',
    verificationDeadline: deadline
  }).returning();

  await db.update(radarEvents)
    .set({ isPromoted: true, promotedSignalId: newSignal.id })
    .where(eq(radarEvents.id, eventId));

  return newSignal;
}
