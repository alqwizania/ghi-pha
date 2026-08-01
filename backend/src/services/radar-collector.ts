import { surveillanceSources, radarEvents, signals } from '../db/schema';
import { eq, gte } from 'drizzle-orm';

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
const RETRO_WINDOW_DAYS = 14;

export function cutoffDate(): string {
  return new Date(Date.now() - RETRO_WINDOW_DAYS * 86400000).toISOString().substring(0, 10);
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
}

// ============================================================
// FETCHER 1: WHO Disease Outbreak News (JSON API)
// ============================================================
async function fetchWHO_DONs(): Promise<SourceResult> {
  const cutoff = cutoffDate();
  const res = await safeFetch('https://www.who.int/api/news/diseaseoutbreaknews?sf_culture=en&$orderby=PublicationDate%20desc&$top=30');
  if (!res.body) return failed('WHO_DONS', res.status, res.detail);
  try {
    const data = JSON.parse(res.body);
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
async function fetchWHO_Mpox(): Promise<SourceResult> {
  const cutoff = cutoffDate();
  const res = await safeFetch('https://xmart-api-public.who.int/MPX/V_MPX_VALIDATED_DAILY?$orderby=DATE%20desc&$top=300');
  if (!res.body) return failed('WHO_MPX_API', res.status, res.detail);
  try {
    const data = JSON.parse(res.body);
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
const RELIEFWEB_APPNAME = '';

async function fetchReliefWeb(): Promise<SourceResult> {
  if (!RELIEFWEB_APPNAME) {
    return failed('RELIEFWEB', 'disabled', 'ReliefWeb API v2 requires an approved appname; none configured');
  }
  const cutoff = cutoffDate();
  const url = `https://api.reliefweb.int/v2/reports?appname=${RELIEFWEB_APPNAME}&limit=20&sort[]=date:desc&filter[field]=theme&filter[value][]=Health&filter[value][]=Epidemic&fields[include][]=title&fields[include][]=date.original&fields[include][]=country.name&fields[include][]=body-html&fields[include][]=url`;
  const res = await safeFetch(url);
  if (!res.body) return failed('RELIEFWEB', res.status, res.detail);
  try {
    const data = JSON.parse(res.body);
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
async function fetchRSS(sourceId: string, sourceName: string, feedUrl: string): Promise<SourceResult> {
  const cutoff = cutoffDate();
  const res = await safeFetch(feedUrl);
  if (!res.body) return failed(sourceId, res.status, res.detail);
  const xml = res.body;
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
async function fetchHTMLTitles(sourceId: string, sourceName: string, pageUrl: string): Promise<SourceResult> {
  const res = await safeFetch(pageUrl);
  if (!res.body) return failed(sourceId, res.status, res.detail);
  const html = res.body;
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
// MAIN SCAN: FETCH ALL REAL SOURCES IN PARALLEL
// ============================================================
export async function fetchGlobalRadarScan(db?: any) {
  if (db) await initializeSources(db);

  // CIDRAP retired its site-wide rss.xml (it still resolves but has been
  // frozen since 2022). Live content is only published on per-topic feeds.
  const cidrapTopics: Array<[string, string]> = [
    ['Misc Emerging Topics', '31175'],
    ['COVID-19', '178636'],
    ['Avian Influenza', '49'],
    ['Measles', '78'],
    ['Ebola', '64'],
    ['Mpox', '230556'],
    ['Cholera', '58'],
    ['MERS-CoV', '84'],
  ];

  // Run all fetchers in parallel with individual error isolation
  const results = await Promise.allSettled([
    // Tier 1: JSON APIs
    fetchWHO_DONs(),
    fetchWHO_Mpox(),
    fetchReliefWeb(),
    // Tier 2: RSS Feeds
    fetchRSS('CDC_TRAVEL', 'CDC Travel Health Notices', 'https://tools.cdc.gov/api/v2/resources/media/316422.rss'),
    fetchRSS('WHO_NEWS', 'WHO News & Features', 'https://www.who.int/rss-feeds/news-english.xml'),
    fetchRSS('PAHO', 'PAHO Pan American Health', 'https://www.paho.org/en/rss.xml'),
    ...cidrapTopics.map(([topic, id]) =>
      fetchRSS('CIDRAP', `CIDRAP — ${topic}`, `https://www.cidrap.umn.edu/news/${id}/rss`)),
    // Tier 3: HTML Extraction
    fetchHTMLTitles('WHO_AFRO', 'WHO AFRO Africa Outbreaks', 'https://www.afro.who.int/health-topics/disease-outbreaks'),
    fetchHTMLTitles('ECDC', 'ECDC Communicable Disease Threats', 'https://www.ecdc.europa.eu/en/threats-and-outbreaks'),
  ]);

  // Collect events and keep the worst diagnostic seen per source, so one
  // healthy CIDRAP topic feed cannot mask another that has broken.
  const cutoff = cutoffDate();
  const allEvents: ParsedEvent[] = [];
  const sourceStats: Record<string, number> = {};
  const diagnostics: Record<string, string> = {};
  const degraded: string[] = [];

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[GHI Radar] Fetcher rejected unexpectedly:', result.reason);
      continue;
    }
    const { sourceId, events, status, detail } = result.value;
    sourceStats[sourceId] = (sourceStats[sourceId] || 0) + events.length;
    allEvents.push(...events);

    if (status !== 'ok' && status !== 'empty') {
      // A hard failure always wins: the source is broken, not merely quiet.
      diagnostics[sourceId] = `${status}: ${detail}`;
      if (!degraded.includes(sourceId)) degraded.push(sourceId);
    } else if (status === 'empty' && !diagnostics[sourceId]) {
      diagnostics[sourceId] = `empty: ${detail}`;
    }
  }

  // Drop benign "empty" notes for sources that other feeds filled in anyway.
  for (const sourceId of Object.keys(diagnostics)) {
    if (sourceStats[sourceId] > 0 && diagnostics[sourceId].startsWith('empty:')) {
      delete diagnostics[sourceId];
    }
  }

  const liveSources = Object.keys(sourceStats).filter((s) => sourceStats[s] > 0);
  console.log(`[GHI Radar] Fetched ${allEvents.length} events from ${liveSources.length} live sources:`, sourceStats);
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

    try {
      const existing = await db.query.radarEvents.findMany({
        where: gte(radarEvents.dateReported, cutoff),
        columns: { sourceId: true, title: true },
      });
      for (const row of existing) seen.add(dedupeKey(row.sourceId || '', row.title || ''));
    } catch (err) {
      console.error('[GHI Radar] Could not load existing events for dedupe:', err);
    }

    for (const evt of allEvents) {
      try {
        const key = dedupeKey(evt.sourceId, evt.title);
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);

        if (evt.dateReported >= cutoff) {
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
            summary: evt.summary,
            sourceUrl: evt.sourceUrl,
            boardType: evt.boardType,
            riskLevel: evt.riskLevel,
            isPromoted: false
          }).onConflictDoNothing();
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

  return {
    status: degraded.length > 0 ? 'degraded' : 'success',
    count: allEvents.length,
    inserted: insertedCount,
    skippedDuplicates: skippedCount,
    cutoffDate: cutoff,
    sources: sourceStats,
    degraded,
    diagnostics,
  };
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
