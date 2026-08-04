import { useState, useEffect, useRef } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { geoCentroid } from 'd3-geo';
import { 
  Globe, 
  Radio, 
  CheckCircle2, 
  ExternalLink, 
  RefreshCw, 
  ArrowUpRight,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Crosshair,
  X,
  Rss,
  Search
} from 'lucide-react';
import { fetchRadarEvents, fetchRadarSources, triggerRadarScan, promoteRadarEvent } from '../lib/api';

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

/**
 * Two-letter code for a country label.
 *
 * The 110m world atlas carries no ISO codes, so codes are held here for the
 * countries GHI actually reports on and derived from the name otherwise.
 * Derivation is a fallback, not the rule: initials would render Sudan and
 * South Sudan identically, and on a threat map that is not a cosmetic error.
 */
const COUNTRY_CODES: Record<string, string> = {
  'Saudi Arabia': 'SA', 'Yemen': 'YE', 'Oman': 'OM', 'United Arab Emirates': 'AE',
  'Qatar': 'QA', 'Bahrain': 'BH', 'Kuwait': 'KW', 'Iraq': 'IQ', 'Iran': 'IR',
  'Jordan': 'JO', 'Syria': 'SY', 'Lebanon': 'LB', 'Israel': 'IL', 'Egypt': 'EG',
  'Sudan': 'SD', 'South Sudan': 'SS', 'Eritrea': 'ER', 'Djibouti': 'DJ',
  'Ethiopia': 'ET', 'Somalia': 'SO', 'Kenya': 'KE', 'Uganda': 'UG', 'Tanzania': 'TZ',
  'Dem. Rep. Congo': 'CD', 'Congo': 'CG', 'Nigeria': 'NG', 'Niger': 'NE', 'Chad': 'TD',
  'Mali': 'ML', 'Burkina Faso': 'BF', 'Ghana': 'GH', 'Cameroon': 'CM',
  'Central African Rep.': 'CF', 'Angola': 'AO', 'Zambia': 'ZM', 'Zimbabwe': 'ZW',
  'Mozambique': 'MZ', 'Malawi': 'MW', 'Madagascar': 'MG', 'South Africa': 'ZA',
  'Morocco': 'MA', 'Algeria': 'DZ', 'Tunisia': 'TN', 'Libya': 'LY',
  'Pakistan': 'PK', 'Afghanistan': 'AF', 'India': 'IN', 'Bangladesh': 'BD',
  'Nepal': 'NP', 'Sri Lanka': 'LK', 'China': 'CN', 'Japan': 'JP', 'South Korea': 'KR',
  'North Korea': 'KP', 'Vietnam': 'VN', 'Thailand': 'TH', 'Cambodia': 'KH',
  'Laos': 'LA', 'Myanmar': 'MM', 'Malaysia': 'MY', 'Indonesia': 'ID',
  'Philippines': 'PH', 'Papua New Guinea': 'PG', 'Australia': 'AU', 'New Zealand': 'NZ',
  'Russia': 'RU', 'Turkey': 'TR', 'Ukraine': 'UA', 'Poland': 'PL', 'Germany': 'DE',
  'France': 'FR', 'Spain': 'ES', 'Portugal': 'PT', 'Italy': 'IT', 'Greece': 'GR',
  'United Kingdom': 'GB', 'Ireland': 'IE', 'Netherlands': 'NL', 'Belgium': 'BE',
  'Switzerland': 'CH', 'Austria': 'AT', 'Czechia': 'CZ', 'Romania': 'RO',
  'Bulgaria': 'BG', 'Serbia': 'RS', 'Croatia': 'HR', 'Hungary': 'HU',
  'Sweden': 'SE', 'Norway': 'NO', 'Finland': 'FI', 'Denmark': 'DK',
  'United States of America': 'US', 'Canada': 'CA', 'Mexico': 'MX', 'Brazil': 'BR',
  'Argentina': 'AR', 'Chile': 'CL', 'Peru': 'PE', 'Colombia': 'CO',
  'Venezuela': 'VE', 'Bolivia': 'BO', 'Ecuador': 'EC', 'Paraguay': 'PY',
  'Uruguay': 'UY', 'Cuba': 'CU', 'Haiti': 'HT', 'Dominican Rep.': 'DO',
  'Guatemala': 'GT', 'Honduras': 'HN', 'Nicaragua': 'NI', 'Costa Rica': 'CR',
  'Panama': 'PA', 'Kazakhstan': 'KZ', 'Uzbekistan': 'UZ', 'Mongolia': 'MN',
};

const countryCode = (name: string): string =>
  COUNTRY_CODES[name] ?? name.replace(/[^A-Za-z ]/g, '').slice(0, 2).toUpperCase();

interface GlobalRadarViewProps {
  user?: any;
  onPromoteToTriage?: () => void;
}

interface RadarEvent {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  disease: string;
  country: string;
  lat: number;
  lng: number;
  dateReported: string;
  cases: number;
  deaths: number;
  cfr?: number;
  summary: string;
  sourceUrl: string;
  boardType: 'biological' | 'environmental_cbrn';
  riskLevel: 'Critical' | 'High' | 'Moderate' | 'Low';
  isPromoted?: boolean;
  /**
   * The IHR scoring attached by /api/radar/events. `corroboration` is how many
   * *other* independent sources report the same disease and country — the
   * strongest evidence this system produces, and untyped here until now, which
   * is why the map had no way to show it.
   */
  score?: {
    tier: 'critical' | 'high' | 'moderate' | 'routine';
    domainsAtTwo: number;
    mandatoryIhr: boolean;
    confidence: 'high' | 'medium' | 'low';
    reportsOccurrence: boolean;
    corroboration?: number;
    credibility?: number;
    confidenceScore?: number;
  } | null;
}

// Result of POST /api/radar/scan. `degraded` lists sources that failed to
// respond rather than sources that simply had nothing new to report.
interface ScanResult {
  status: 'success' | 'degraded' | 'error';
  count: number;
  inserted: number;
  skippedDuplicates?: number;
  cutoffDate?: string;
  sources?: Record<string, number>;
  degraded: string[];
  diagnostics: Record<string, string>;
  // 'fallback' means sources configured for structured extraction ran on the
  // legacy title scraper instead — a quality downgrade worth showing.
  extraction?: { mode: 'structured' | 'fallback' | 'legacy'; detail: string; affected: string[] };
}

interface RadarSource {
  id: string;
  name: string;
  type: string;
  url: string;
  category?: string;
  enabled?: boolean;
  disabledReason?: string | null;
  // Persisted per-source health, written by every scan. Present on load, so
  // the drawer reports real state without the operator triggering a scan.
  lastFetchedAt?: string | null;
  lastChangedAt?: string | null;
  lastStatus?: string;
  lastError?: string | null;
  consecutiveFailures?: number;
  eventsLastExtracted?: number;
}

export default function GlobalRadarView({ onPromoteToTriage }: GlobalRadarViewProps) {
  const [selectedBoard, setSelectedBoard] = useState<'all' | 'biological' | 'environmental_cbrn'>('all');
  const [diseaseFilter, setDiseaseFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  /**
   * The retrospective window the operator is looking through, in days.
   *
   * Opens at 14 — the default collection window — rather than at everything,
   * because the first question about a marker is almost always "is this now?".
   * Sources with longer windows (WHO publishes mpox quarterly) only appear as
   * the slider is widened, which makes the age of a signal a property the
   * operator can see rather than one they have to click each marker to learn.
   */
  const [windowDays, setWindowDays] = useState<number>(14);
  const [events, setEvents] = useState<RadarEvent[]>([]);
  // Non-null when the last load failed. The map must never imply data it
  // does not have.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [sources, setSources] = useState<RadarSource[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<RadarEvent | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);

  // Panel Collapsible States (Floating Overlays)
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [isStreamOpen, setIsStreamOpen] = useState(false);
  // Collapsed by default. The legend is reference material — needed once while
  // learning the map, then never again — so it should not permanently occupy a
  // corner of the operating picture.
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  /**
   * True screen fullscreen, via the browser's own API rather than a CSS
   * overlay.
   *
   * A `fixed inset-0` div was the obvious approach and it did not work: an
   * ancestor carries backdrop-blur, which makes it a containing block for fixed
   * descendants, so the "fullscreen" map stopped politely at the sidebar. The
   * native API sidesteps every stacking question and gives the whole display
   * rather than the whole viewport — which is what an operator means by
   * fullscreen on a wall-mounted screen.
   */
  const mapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else mapRef.current?.requestFullscreen?.();
  };
  // Independent agreement is the strongest evidence this system produces, and
  // filtering to it is the fastest way to separate the confirmed from the
  // single-sourced.
  const [corroboratedOnly, setCorroboratedOnly] = useState(false);

  // Map Zoom & Center State
  const [zoom, setZoom] = useState(2.8);
  const [center, setCenter] = useState<[number, number]>([35, 20]); // Centered on Middle East / KSA


  const fetchSources = async () => {
    try {
      setSources(await fetchRadarSources());
    } catch {
      setSources([]);
    }
  };

  // Health prefers the current scan's result, then falls back to the health
  // persisted alongside the source, so the drawer is meaningful on first load
  // rather than only after the operator triggers a scan.
  const sourceHealth = (src: RadarSource): 'live' | 'quiet' | 'down' | 'off' | 'unknown' => {
    if (src.enabled === false) return 'off';

    if (scanResult) {
      if (scanResult.degraded.includes(src.id)) return 'down';
      if ((scanResult.sources?.[src.id] ?? 0) > 0) return 'live';
      if (scanResult.diagnostics[src.id]) return 'quiet';
    }

    if (!src.lastFetchedAt) return 'unknown';
    if ((src.consecutiveFailures ?? 0) > 0) return 'down';
    if ((src.eventsLastExtracted ?? 0) > 0) return 'live';
    return 'quiet';
  };

  const HEALTH_STYLES: Record<string, { dot: string; label: string }> = {
    live: { dot: 'bg-ghi-success shadow-[0_0_6px_#39FF14]', label: 'Live' },
    quiet: { dot: 'bg-ghi-warning shadow-[0_0_6px_#F4B400]', label: 'No new items' },
    down: { dot: 'bg-ghi-critical shadow-[0_0_6px_#FF3131]', label: 'Unavailable' },
    off: { dot: 'bg-slate-600', label: 'Not collecting' },
    unknown: { dot: 'bg-slate-700', label: 'Not yet scanned' },
  };

  const fetchRadarData = async () => {
    try {
      const data = await fetchRadarEvents();
      if (data && data.length > 0) {
        setEvents(data.map((e: any) => ({
          ...e,
          lat: Number(e.lat) || 20,
          lng: Number(e.lng) || 30
        })));
        setLoadError(null);
      } else {
        setEvents([]);
        setLoadError(null);
      }
    } catch (err) {
      // This used to fall back to a hardcoded set of invented outbreaks —
      // cholera in Yemen at 420 cases, meningococcal disease in Sudan — so an
      // operator whose API was down saw a plausible threat map instead of an
      // error. On a surveillance platform that is the most dangerous failure
      // mode there is: it manufactures both reassurance and alarm, and nothing
      // on screen distinguishes it from real reporting.
      setEvents([]);
      setLoadError(err instanceof Error ? err.message : 'Could not reach the surveillance API');
    }
  };

  useEffect(() => {
    fetchRadarData();
    fetchSources();
  }, []);

  // The browser owns fullscreen state: Escape and F11 change it without ever
  // touching our button, so listen rather than assume.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const triggerScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const result: ScanResult = await triggerRadarScan();
      setScanResult(result);
      await fetchRadarData();
    } catch {
      setScanResult({ status: 'error', count: 0, inserted: 0, degraded: [], diagnostics: {} });
    } finally {
      setScanning(false);
    }
  };

  const handlePromoteToTriage = async (event: RadarEvent) => {
    setPromotingId(event.id);
    try {
      await promoteRadarEvent(event.id);
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, isPromoted: true } : e));
      if (onPromoteToTriage) onPromoteToTriage();
    } catch {
      // Leave the event un-promoted so the operator can retry rather than
      // seeing a success state for a promotion that did not happen.
    } finally {
      setPromotingId(null);
    }
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.4, 8));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.4, 1));
  const handleResetMap = () => {
    setZoom(2.8);
    setCenter([35, 20]);
  };

  const uniqueDiseases = Array.from(new Set(events.map(e => e.disease)));

  // The window cutoff as a date string, compared directly against
  // `dateReported` which the API returns as YYYY-MM-DD.
  const windowCutoff = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);

  const filteredEvents = events.filter(e => {
    if (String(e.dateReported || '').slice(0, 10) < windowCutoff) return false;
    if (corroboratedOnly && (e.score?.corroboration ?? 0) < 1) return false;
    if (selectedBoard !== 'all' && e.boardType !== selectedBoard) return false;
    if (diseaseFilter !== 'all' && e.disease !== diseaseFilter) return false;
    if (riskFilter !== 'all' && e.riskLevel !== riskFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = e.title?.toLowerCase().includes(q);
      const matchCountry = e.country?.toLowerCase().includes(q);
      const matchDisease = e.disease?.toLowerCase().includes(q);
      if (!matchTitle && !matchCountry && !matchDisease) return false;
    }
    return true;
  });

  const newestEvent = filteredEvents.length
    ? filteredEvents.map((e: any) => String(e.dateReported || '').slice(0, 10)).sort().at(-1)
    : null;

  /**
   * Daily event counts across the visible window, stacked by severity.
   *
   * Built from the same filtered set the map draws, so the curve and the dots
   * can never disagree. Capped at 90 buckets: beyond that the bars are thinner
   * than the gaps between them and the shape stops being readable.
   */
  const timeline = (() => {
    const span = Math.min(windowDays, 90);
    const buckets = new Map<string, { date: string; ageDays: number; critical: number; high: number; other: number; total: number }>();
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      buckets.set(d, { date: d, ageDays: i + 1, critical: 0, high: 0, other: 0, total: 0 });
    }
    for (const e of filteredEvents) {
      const key = String(e.dateReported || '').slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      if (e.riskLevel === 'Critical') b.critical++;
      else if (e.riskLevel === 'High') b.high++;
      else b.other++;
      b.total++;
    }
    const days = [...buckets.values()];
    return { days, peak: Math.max(1, ...days.map(d => d.total)) };
  })();

  // Countries currently reporting, so their code stays visible at any zoom.
  const eventCountries = new Set<string>(filteredEvents.map((e: any) => e.country));

  /**
   * The ticker carries emergent news, not a recital of the map.
   *
   * It previously scrolled every filtered event twice over, which meant a
   * routine item from three weeks ago moved past at the same weight as a
   * critical one reported this morning. A feed whose job is to catch the eye
   * has to be ordered by what deserves the eye: severity first, then recency.
   * Capped at 15 so the loop comes round often enough to be read.
   */


  return (
    <div
      ref={mapRef}
      className={isFullscreen
        ? 'relative w-full h-screen overflow-hidden bg-[#060a14]'
        : 'relative w-full h-[calc(100vh-170px)] min-h-[500px] rounded-3xl overflow-hidden border border-white/10 bg-[#060a14] shadow-2xl'}>
      
      {/* FULLSCREEN REAL WORLD MAP CANVAS (react-simple-maps) */}
      <div className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing">
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ scale: 180 }}
          className="w-full h-full"
        >
          <ZoomableGroup zoom={zoom} center={center} onMoveEnd={({ coordinates, zoom }: { coordinates: [number, number]; zoom: number }) => {
            setCenter(coordinates);
            setZoom(zoom);
          }}>
            {/* Country Polygons */}
            <Geographies geography={geoUrl}>
              {({ geographies }: { geographies: any[] }) =>
                geographies.map((geo: any) => {
                  const isKSA = geo.properties.name === "Saudi Arabia";
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={isKSA ? "#0c2438" : "#101827"}
                      stroke={isKSA ? "#00F2FF" : "#1e293b"}
                      strokeWidth={isKSA ? 0.8 : 0.4}
                      style={{
                        default: { outline: "none", transition: "all 300ms" },
                        hover: { fill: "#1a2a42", stroke: "#00F2FF", outline: "none" },
                        pressed: { fill: "#00F2FF22", outline: "none" },
                      }}
                    />
                  );
                })
              }
            </Geographies>

            {/*
              Country initials.
              Deliberately quiet: this is a threat map, and a full label set
              competes with the markers for the same attention. Codes appear
              only where they earn their place — the Kingdom always, countries
              currently reporting an event always, and everything else only
              once the operator has zoomed in far enough to be reading a region
              rather than scanning the globe.
            */}
            <Geographies geography={geoUrl}>
              {({ geographies }: { geographies: any[] }) =>
                geographies.map((geo: any) => {
                  const name = geo.properties.name;
                  const isKSA = name === 'Saudi Arabia';
                  const hasEvent = eventCountries.has(name);
                  if (!isKSA && !hasEvent && zoom < 2.2) return null;

                  const centroid = geoCentroid(geo);
                  if (!centroid || Number.isNaN(centroid[0])) return null;

                  return (
                    <Marker key={`${geo.rsmKey}-label`} coordinates={centroid as [number, number]}>
                      <text
                        textAnchor="middle"
                        /*
                          Countries with an event get their code lifted clear of
                          the marker. Both land on the centroid otherwise, and
                          Saudi Arabia's code was sitting directly on top of the
                          MERS dot — the one marker on the map that must stay
                          readable.
                        */
                        dy={hasEvent ? -9 / zoom : 2}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                        fontSize={9 / zoom}
                        letterSpacing={1.2 / zoom}
                        fontWeight={700}
                        fill={isKSA ? '#00F2FF' : hasEvent ? '#94a3b8' : '#475569'}
                        opacity={isKSA ? 0.95 : hasEvent ? 0.7 : 0.45}
                      >
                        {countryCode(name)}
                      </text>
                    </Marker>
                  );
                })
              }
            </Geographies>

            {/* Outbreak Markers at Real Longitude & Latitude */}
            {filteredEvents.map((evt) => {
              const isCritical = evt.riskLevel === 'Critical';
              const isSelected = selectedEvent?.id === evt.id;
              // Semantic colour, separate from the teal accent: severity has to
              // read at a glance without matching the interface chrome.
              // Sized for a comfortable click target without becoming the blot
              // the original 8px markers were. The transparent hit area below
              // does the rest, so the visible dot never has to grow to be
              // usable.
              const corroborated = evt.score?.corroboration ?? 0;
              const accent = isCritical
                ? { colour: '#FF3131', core: 5.0, ring: 13 }
                : evt.riskLevel === 'High'
                  ? { colour: '#FFB020', core: 4.7, ring: 11.5 }
                  : { colour: '#00F2FF', core: 4.5, ring: 10.5 };

              return (
                <Marker
                  key={evt.id}
                  coordinates={[evt.lng, evt.lat]}
                  onClick={() => setSelectedEvent(evt)}
                >
                  {/*
                    Counter-scaled by zoom so a marker stays the same size on
                    screen at every zoom level. Without this, zooming in to read
                    a region turns each dot into a blot that covers the country
                    it is marking.
                  */}
                  <g className="cursor-pointer group" transform={`scale(${1 / zoom})`}>
                    {/*
                      A radar sweep rather than Tailwind's animate-ping. ping
                      scales the whole element from the centre and fades out
                      hard, which reads as a bouncing blob; animating the radius
                      of a stroked ring reads as a sweep expanding outward,
                      which is what the instrument this borrows from does.
                      Criticals sweep faster — urgency carried by rhythm rather
                      than by size.
                    */}
                    <circle
                      r={accent.ring}
                      fill="none"
                      stroke={accent.colour}
                      strokeWidth={0.6}
                      opacity={0.5}
                    >
                      <animate attributeName="r" values={`${accent.core};${accent.ring}`}
                        dur={isCritical ? '1.8s' : '2.8s'} repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.55;0"
                        dur={isCritical ? '1.8s' : '2.8s'} repeatCount="indefinite" />
                    </circle>

                    {/* A soft halo keeps the dot legible over dark landmass. */}
                    <circle r={accent.core + 1.6} fill={accent.colour} opacity={0.18} />

                    <circle
                      r={accent.core}
                      fill={accent.colour}
                      stroke="#060a14"
                      strokeWidth={0.5}
                      className="transition-all duration-300 group-hover:opacity-80"
                    />

                    {/* Selection is a ring, not a size change — the marker must
                        not move or grow when it becomes the active one. */}
                    {isSelected && (
                      <circle r={accent.core + 3} fill="none" stroke="#ffffff"
                        strokeWidth={0.8} opacity={0.9} />
                    )}

                    {/*
                      Corroboration: a second ring for events more than one
                      independent source reports. Independent agreement is the
                      strongest evidence event-based surveillance produces, and
                      it was being computed, stored, and shown to nobody.

                      Deliberately a ring rather than a colour or a size change
                      — severity already owns colour and size, and confidence is
                      a separate axis from how bad something is. A corroborated
                      Moderate and an uncorroborated Critical must stay
                      distinguishable at a glance.
                    */}
                    {corroborated > 0 && (
                      <circle
                        r={accent.core + 2.6}
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth={0.7}
                        opacity={0.55}
                        strokeDasharray="1.5 1.5"
                      />
                    )}

                    {/* Invisible hit area. Clicking a marker on a world map is
                        a fine-motor task, so the target is larger than the dot
                        rather than the dot being drawn larger than it needs. */}
                    <circle r={accent.core + 6} fill="transparent" />

                    {/* Native tooltip on hover — reading a marker should not
                        require selecting it and losing the current selection. */}
                    <title>{`${evt.disease} — ${evt.country}${evt.cases ? ` · ${evt.cases} cases` : ''}` +
                      `${corroborated > 0 ? ` · corroborated by ${corroborated} other source${corroborated === 1 ? '' : 's'}` : ' · single source'}`}</title>
                  </g>
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>
      </div>

      {/* FLOATING TOP HEADER OVERLAY WITH SEARCH & FILTERS */}
      <div className="absolute top-4 left-4 right-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pointer-events-none z-30">
        
        {/* Left Badge: Title & Cutoff */}
        <div className="flex items-center gap-3 bg-slate-950/85 backdrop-blur-xl border border-white/10 p-2.5 px-4 rounded-2xl pointer-events-auto shadow-2xl">
          <div className="p-1.5 rounded-xl bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/40">
            <Globe className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-black uppercase text-white tracking-wider">Global Outbreak Radar</h2>
              <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/40">
                {sources.length} Feeds Registered
              </span>
            </div>
            <p className="text-[9px] text-slate-400 font-bold">
              {/* "Retrospective Window Since: last 14 days" said the same thing
                  as the window slider, in wording nobody outside the codebase
                  uses, and the two could drift apart. What an operator wants
                  here is how much is on the map and how fresh it is. */}
              <span className="text-ghi-teal">{filteredEvents.length}</span> events shown
              {newestEvent && <> · newest <span className="text-ghi-teal">{newestEvent}</span></>}
            </p>
          </div>
        </div>

        {/* Search, Disease Filter, Severity Filter & RSS Feed Controls */}
        <div className="flex items-center gap-2 flex-wrap bg-slate-950/85 backdrop-blur-xl border border-white/10 p-1.5 rounded-2xl pointer-events-auto shadow-2xl text-xs">
          
          {/* Quick Search */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Search outbreak..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-slate-900 border border-white/10 rounded-xl pl-8 pr-3 py-1 text-xs text-white placeholder:text-slate-500 focus:border-ghi-teal outline-none w-36"
            />
          </div>

          {/* Disease Selector */}
          <select
            value={diseaseFilter}
            onChange={e => setDiseaseFilter(e.target.value)}
            className="bg-slate-900 border border-white/10 rounded-xl px-2 py-1 text-xs text-slate-200 focus:border-ghi-teal outline-none"
          >
            <option value="all" className="bg-slate-900 text-white">All Diseases</option>
            {uniqueDiseases.map((d, i) => (
              <option key={i} value={d} className="bg-slate-900 text-white">{d}</option>
            ))}
          </select>

          {/* Severity / Risk Level Filter */}
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
            className="bg-slate-900 border border-white/10 rounded-xl px-2 py-1 text-xs text-slate-200 focus:border-ghi-teal outline-none"
          >
            <option value="all" className="bg-slate-900 text-white">All Severities</option>
            <option value="Critical" className="bg-slate-900 text-white">Critical Only</option>
            <option value="High" className="bg-slate-900 text-white">High Only</option>
            <option value="Moderate" className="bg-slate-900 text-white">Moderate Only</option>
            <option value="Low" className="bg-slate-900 text-white">Low Only</option>
          </select>

          {/*
            Retrospective window.
            The map showed every event it held with no indication of age, so a
            report from three weeks ago and one from this morning were the same
            dot. Dragging this narrows the map to recent reporting and widens it
            to the full retrospective record — the age of a signal becomes
            something the operator can see rather than click to discover.
          */}
          <div className="flex items-center gap-2.5 border-l border-white/10 pl-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500 leading-none">
                Window
              </span>
              <span className="text-[10px] font-black text-ghi-teal tabular-nums leading-none">
                {windowDays >= 200 ? 'All records' : `Last ${windowDays}d`}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={200}
              step={1}
              value={windowDays}
              onChange={e => setWindowDays(Number(e.target.value))}
              title={windowDays >= 200 ? 'All retained records' : `Since ${windowCutoff}`}
              className="w-32 accent-ghi-teal cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 tabular-nums whitespace-nowrap">
              {filteredEvents.length}
            </span>
          </div>

          {/* Corroboration. Two independent sources reporting the same event is
              the strongest evidence event-based surveillance produces, and this
              is the quickest way to separate the confirmed from the rumoured. */}
          <button
            onClick={() => setCorroboratedOnly(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all ${
              corroboratedOnly
                ? 'bg-ghi-teal/20 text-ghi-teal border-ghi-teal/40'
                : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'}`}
            title="Only events reported by more than one independent source"
          >
            <span className="text-[11px] leading-none">✦</span> Corroborated
          </button>

          {/* Corroboration. Two independent sources reporting the same event is
              the strongest evidence event-based surveillance produces, and this
              is the quickest way to separate the confirmed from the rumoured. */}

          {/* Board Category Pill Tabs */}
          <div className="flex items-center gap-1 border-l border-white/10 pl-2">
            <button
              onClick={() => setSelectedBoard('all')}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                selectedBoard === 'all' ? 'bg-ghi-teal text-slate-950 shadow-[0_0_10px_#00F2FF]' : 'text-slate-400 hover:text-white'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSelectedBoard('biological')}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                selectedBoard === 'biological' ? 'bg-ghi-teal text-slate-950 shadow-[0_0_10px_#00F2FF]' : 'text-slate-400 hover:text-white'
              }`}
            >
              Bio
            </button>
            <button
              onClick={() => setSelectedBoard('environmental_cbrn')}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                selectedBoard === 'environmental_cbrn' ? 'bg-ghi-warning text-slate-950 shadow-[0_0_10px_#F4B400]' : 'text-slate-400 hover:text-white'
              }`}
            >
              CBRN
            </button>
          </div>

          {/* Scan Button */}
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="p-1.5 rounded-xl bg-ghi-teal/20 text-ghi-teal hover:bg-ghi-teal hover:text-slate-950 transition-all border border-ghi-teal/40 ml-1"
            title="Trigger Source Scan"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* SCAN RESULT / SOURCE HEALTH BANNER */}
      {scanResult && (
        <div
          className={`absolute top-16 right-6 z-40 max-w-sm rounded-xl border backdrop-blur-xl px-3 py-2 shadow-2xl ${
            scanResult.status === 'success'
              ? 'bg-slate-950/90 border-ghi-success/40'
              : 'bg-slate-950/90 border-ghi-warning/50'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider text-white">
                {scanResult.status === 'error'
                  ? 'Scan Failed'
                  : `Scan Complete — ${scanResult.inserted} New Event${scanResult.inserted === 1 ? '' : 's'}`}
              </p>
              {scanResult.degraded.length > 0 && (
                <p className="mt-1 text-[10px] leading-snug text-ghi-warning">
                  {scanResult.degraded.length} source{scanResult.degraded.length === 1 ? '' : 's'} unavailable:{' '}
                  {scanResult.degraded.join(', ')}
                </p>
              )}
              {scanResult.status === 'success' && scanResult.degraded.length === 0 && (
                <p className="mt-1 text-[10px] text-slate-400">All sources responding.</p>
              )}
              {scanResult.extraction?.mode === 'fallback' && (
                <p className="mt-1 text-[10px] leading-snug text-ghi-warning">
                  {scanResult.extraction.affected.length} source
                  {scanResult.extraction.affected.length === 1 ? '' : 's'} used the basic extractor —
                  structured extraction is not configured.
                </p>
              )}
            </div>
            <button
              onClick={() => setScanResult(null)}
              className="text-slate-500 hover:text-white text-[10px] font-black leading-none"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Drawer triggers, clearing the timeline strip below them. The old
          offset assumed the single-line RSS ticker; the histogram is taller and
          the two overlapped. */}
      <div className="absolute left-6 bottom-[124px] flex flex-row md:flex-col gap-2 z-30">
        
        {/* Toggle 45 Sources Monitor Drawer */}
        <button
          onClick={() => {
            setIsSourcesOpen(!isSourcesOpen);
            setIsStreamOpen(false);
          }}
          className={`p-2.5 px-3.5 rounded-2xl border backdrop-blur-xl transition-all shadow-2xl flex items-center gap-2 text-xs font-black uppercase tracking-wider ${
            isSourcesOpen
              ? 'bg-ghi-teal text-slate-950 border-ghi-teal shadow-[0_0_20px_#00F2FF]'
              : 'bg-slate-950/90 text-slate-300 border-white/10 hover:border-ghi-teal/40 hover:text-ghi-teal'
          }`}
        >
          <Radio className="w-4 h-4 text-ghi-teal" />
          <span>{sources.length} Sources Monitor</span>
        </button>

        {/* Toggle Live Stream Drawer */}
        <button
          onClick={() => {
            setIsStreamOpen(!isStreamOpen);
            setIsSourcesOpen(false);
          }}
          className={`p-2.5 px-3.5 rounded-2xl border backdrop-blur-xl transition-all shadow-2xl flex items-center gap-2 text-xs font-black uppercase tracking-wider ${
            isStreamOpen
              ? 'bg-ghi-teal text-slate-950 border-ghi-teal shadow-[0_0_20px_#00F2FF]'
              : 'bg-slate-950/90 text-slate-300 border-white/10 hover:border-ghi-teal/40 hover:text-ghi-teal'
          }`}
        >
          <Layers className="w-4 h-4 text-ghi-teal" />
          <span>Live Ingested Signals ({filteredEvents.length})</span>
        </button>
      </div>

      {/* FLOATING MAP ZOOM CONTROLS (Right Side - Above RSS Ticker) */}
      <div className="absolute right-6 bottom-[124px] flex flex-col gap-2 z-30">
        <button
          onClick={handleZoomIn}
          className="p-2.5 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-white/10 text-slate-300 hover:text-ghi-teal hover:border-ghi-teal/40 transition-all shadow-2xl"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-2.5 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-white/10 text-slate-300 hover:text-ghi-teal hover:border-ghi-teal/40 transition-all shadow-2xl"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetMap}
          className="p-2.5 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-white/10 text-slate-300 hover:text-ghi-teal hover:border-ghi-teal/40 transition-all shadow-2xl"
          title="Reset Projection"
        >
          <Crosshair className="w-4 h-4" />
        </button>
        {/* Fullscreen. A threat map is the one view where the surrounding
            navigation is pure cost. Escape returns. */}
        <button
          onClick={toggleFullscreen}
          className={`p-2.5 rounded-2xl backdrop-blur-xl border transition-all shadow-2xl ${
            isFullscreen
              ? 'bg-ghi-teal/20 border-ghi-teal/50 text-ghi-teal'
              : 'bg-slate-950/90 border-white/10 text-slate-300 hover:text-ghi-teal hover:border-ghi-teal/40'}`}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen map'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* FLOATING DRAWER 1: 45 SOURCES MONITOR (COLLAPSIBLE OVERMAP) */}
      {isSourcesOpen && (
        <div className="absolute left-6 bottom-28 w-96 max-h-[380px] bg-slate-950/95 backdrop-blur-2xl border border-white/15 rounded-3xl p-5 shadow-2xl z-40 overflow-hidden flex flex-col animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex justify-between items-center mb-3 shrink-0 border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-ghi-teal animate-pulse" />
              <h3 className="text-xs font-black text-white uppercase tracking-wider">
                {sources.filter((s) => s.enabled !== false).length} of {sources.length} Sources Collecting
              </h3>
            </div>
            <button onClick={() => setIsSourcesOpen(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {!scanResult && sources.every((s) => !s.lastFetchedAt) && (
            <p className="text-[9px] text-slate-400 font-bold mb-2 shrink-0">
              No collection has run yet — statuses below are unverified.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 overflow-y-auto pr-1 flex-1">
            {sources.map((src) => {
              const health = sourceHealth(src);
              const style = HEALTH_STYLES[health];
              return (
                <div
                  key={src.id}
                  className="p-2 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-2"
                  title={scanResult?.diagnostics[src.id] || src.disabledReason || src.lastError || style.label}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{src.name}</p>
                    <p className="text-[9px] text-slate-400 truncate">{style.label}</p>
                  </div>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`}></span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FLOATING DRAWER 2: LIVE INGESTED SIGNALS STREAM (COLLAPSIBLE OVERMAP) */}
      {isStreamOpen && (
        <div className="absolute left-6 bottom-28 w-96 max-h-[420px] bg-slate-950/95 backdrop-blur-2xl border border-white/15 rounded-3xl p-5 shadow-2xl z-40 overflow-hidden flex flex-col animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex justify-between items-center mb-3 shrink-0 border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-ghi-teal" />
              <h3 className="text-xs font-black text-white uppercase tracking-wider">Live Ingested Signals</h3>
            </div>
            <button onClick={() => setIsStreamOpen(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2.5 overflow-y-auto pr-1 flex-1">
            {filteredEvents.map((evt) => (
              <div
                key={evt.id}
                onClick={() => setSelectedEvent(evt)}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  selectedEvent?.id === evt.id ? 'bg-ghi-teal/10 border-ghi-teal' : 'bg-white/[0.03] border-white/5 hover:border-ghi-teal/30'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[9px] font-black uppercase text-ghi-teal">{evt.sourceName}</span>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                    evt.riskLevel === 'Critical' ? 'bg-ghi-critical/20 text-ghi-critical' : 'bg-ghi-warning/20 text-ghi-warning'
                  }`}>
                    {evt.riskLevel}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-white line-clamp-1 mb-1">{evt.title}</h4>
                <div className="flex justify-between items-center text-[10px] text-slate-400">
                  <span>{evt.disease} • {evt.country}</span>
                  <span>{evt.cases} Cases</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FLOATING CARD: EVENT DETAILS (WHEN MAP MARKER IS CLICKED) */}
      {selectedEvent && (
        <div className="absolute right-6 top-24 w-96 bg-slate-950/95 backdrop-blur-2xl border border-ghi-teal/40 rounded-3xl p-6 shadow-2xl z-40 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="flex justify-between items-start mb-3">
            <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/40">
              {selectedEvent.sourceName}
            </span>
            <button onClick={() => setSelectedEvent(null)} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          <h3 className="text-sm font-black text-white uppercase tracking-wider mb-1 leading-relaxed">
            {selectedEvent.title}
          </h3>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-4">
            {selectedEvent.disease} • {selectedEvent.country}
          </p>

          <div className="grid grid-cols-3 gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/5 text-center text-xs mb-4">
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase block">Cases</span>
              <span className="text-white font-black text-sm">{selectedEvent.cases}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase block">Deaths</span>
              <span className="text-white font-black text-sm">{selectedEvent.deaths}</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase block">CFR</span>
              <span className="text-ghi-critical font-black text-sm">{selectedEvent.cfr || 0}%</span>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed font-medium mb-6 italic">
            "{selectedEvent.summary}"
          </p>

          <div className="flex items-center gap-3">
            {selectedEvent.isPromoted ? (
              <span className="text-xs font-bold text-ghi-success flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Promoted to Triage
              </span>
            ) : (
              <button
                onClick={() => handlePromoteToTriage(selectedEvent)}
                disabled={promotingId === selectedEvent.id}
                className="flex-1 py-2.5 rounded-xl bg-ghi-teal text-slate-950 text-xs font-black uppercase tracking-wider hover:bg-[#33f5ff] transition-all flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(0,242,255,0.3)]"
              >
                <ArrowUpRight className="w-4 h-4" /> Promote to Triage Queue
              </button>
            )}

            <a
              href={selectedEvent.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-all"
              title="Open Official Source"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      )}

      {/* MOVING RSS FEED STRIP UNDER MAP (SHOWN BY DEFAULT) */}
      {loadError && (
        <div className="absolute top-24 left-6 right-6 z-40 max-w-xl rounded-2xl border border-ghi-critical/50 bg-ghi-critical/10 p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-ghi-critical shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z"/>
          </svg>
          <div>
            <p className="text-[11px] font-black text-ghi-critical uppercase tracking-widest">Surveillance data unavailable</p>
            <p className="text-[11px] text-slate-300 mt-1">{loadError}</p>
            <p className="text-[10px] text-slate-500 mt-1">
              Nothing below is current. This is a connection failure, not an all-clear.
            </p>
          </div>
        </div>
      )}

      {/*
        Legend.
        The map encodes three things at once — severity in colour, corroboration
        in a dashed ring, the Kingdom in a highlighted border — and none of it
        was written down anywhere. An operator either learned the code from
        someone or invented their own reading of it, and a wrong reading of a
        threat map is worse than no map.
      */}
      <div className="absolute top-24 right-4 z-30 hidden md:block">
        <button
          onClick={() => setIsLegendOpen(v => !v)}
          className={`flex items-center gap-2 backdrop-blur-xl border rounded-2xl px-3 py-2 shadow-2xl text-[9px] font-black uppercase tracking-[0.2em] transition-all ${
            isLegendOpen
              ? 'bg-ghi-teal/15 border-ghi-teal/40 text-ghi-teal'
              : 'bg-slate-950/85 border-white/10 text-slate-400 hover:text-ghi-teal hover:border-ghi-teal/40'}`}
          title="What the colours and rings mean"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          Legend
        </button>
      </div>

      {/* Collapsed by default: reference material, needed once while learning
          the map and rarely after, so it should not hold a corner of the
          operating picture permanently. */}
      {isLegendOpen && (
      <div className="absolute top-[124px] right-4 z-30 bg-slate-950/92 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 shadow-2xl hidden md:block animate-in fade-in slide-in-from-top-2 duration-200">
        <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2.5">Legend</p>
        <div className="space-y-2">
          {[
            { colour: '#FF3131', label: 'Critical — 3+ IHR domains' },
            { colour: '#FFB020', label: 'High — 2 IHR domains' },
            { colour: '#00F2FF', label: 'Moderate / routine' },
          ].map(k => (
            <div key={k.label} className="flex items-center gap-2.5">
              <svg width="14" height="14" className="shrink-0">
                <circle cx="7" cy="7" r="3.4" fill={k.colour} stroke="#060a14" strokeWidth="0.5" />
              </svg>
              <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">{k.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-2.5 pt-1.5 border-t border-white/5">
            <svg width="14" height="14" className="shrink-0">
              <circle cx="7" cy="7" r="3.4" fill="#00F2FF" />
              <circle cx="7" cy="7" r="5.6" fill="none" stroke="#ffffff" strokeWidth="0.8" opacity="0.6" strokeDasharray="1.5 1.5" />
            </svg>
            <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">Corroborated — 2+ sources</span>
          </div>
          <div className="flex items-center gap-2.5">
            <svg width="14" height="14" className="shrink-0">
              <rect x="1.5" y="3" width="11" height="8" rx="1.5" fill="#0c2438" stroke="#00F2FF" strokeWidth="1" />
            </svg>
            <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">Kingdom of Saudi Arabia</span>
          </div>
        </div>
      </div>
      )}

      {/*
        Was a scrolling RSS ticker: the same events already plotted on the map,
        moving. It was motion rather than information, and it occupied the
        widest strip on the screen.

        A daily histogram earns that space. It answers the question a map cannot
        — is this accelerating? — and it gives the window slider meaning, since
        widening it now visibly extends the curve instead of only changing a
        number. Bars are stacked by severity, and clicking one narrows the
        window to that day.
      */}
      <div className="absolute bottom-4 left-6 right-6 md:right-24 bg-slate-950/90 backdrop-blur-2xl border border-white/10 rounded-2xl px-4 py-2.5 z-30 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Rss className="w-3 h-3 text-ghi-teal" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
              Reporting Timeline
            </span>
            <span className="text-[9px] text-slate-600">
              {filteredEvents.length} events over {windowDays >= 200 ? 'all records' : `${windowDays} days`}
            </span>
          </div>
          {timeline.peak > 0 && (
            <span className="text-[9px] text-slate-600 tabular-nums">peak {timeline.peak}/day</span>
          )}
        </div>

        {/* items-stretch, not items-end: with items-end each bar sizes to its
            content, so the percentage heights below resolve against zero and
            every bar renders 0px tall. */}
        <div className="flex items-stretch gap-[2px] h-14">
          {timeline.days.map(d => (
            <button
              key={d.date}
              onClick={() => setWindowDays(Math.max(1, d.ageDays))}
              title={`${d.date} — ${d.total} event${d.total === 1 ? '' : 's'}${d.critical ? `, ${d.critical} critical` : ''}`}
              className="flex-1 min-w-[2px] h-full flex flex-col justify-end gap-[1px] group"
            >
              {d.critical > 0 && (
                <div className="w-full bg-ghi-critical rounded-sm group-hover:opacity-70 transition-opacity"
                  style={{ height: `${Math.max(6, (d.critical / timeline.peak) * 100)}%` }} />
              )}
              {d.high > 0 && (
                <div className="w-full bg-ghi-warning rounded-sm group-hover:opacity-70 transition-opacity"
                  style={{ height: `${Math.max(6, (d.high / timeline.peak) * 100)}%` }} />
              )}
              {d.other > 0 && (
                <div className="w-full bg-ghi-teal/70 rounded-sm group-hover:opacity-70 transition-opacity"
                  style={{ height: `${Math.max(6, (d.other / timeline.peak) * 100)}%` }} />
              )}
              {d.total === 0 && <div className="w-full h-[2px] bg-white/5 rounded-sm" />}
            </button>
          ))}
        </div>

        <div className="flex justify-between mt-1.5 text-[8px] text-slate-600 tabular-nums">
          <span>{timeline.days[0]?.date}</span>
          <span>today</span>
        </div>
      </div>
    </div>
  );
}
