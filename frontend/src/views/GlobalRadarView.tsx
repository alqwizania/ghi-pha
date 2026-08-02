import { useState, useEffect } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
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
  X,
  Rss,
  Search
} from 'lucide-react';
import { API_BASE_URL, fetchRadarEvents, fetchRadarSources, triggerRadarScan, promoteRadarEvent } from '../lib/api';

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

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
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [sources, setSources] = useState<RadarSource[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<RadarEvent | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);

  // Panel Collapsible States (Floating Overlays)
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [isStreamOpen, setIsStreamOpen] = useState(false);

  // Map Zoom & Center State
  const [zoom, setZoom] = useState(2.8);
  const [center, setCenter] = useState<[number, number]>([35, 20]); // Centered on Middle East / KSA

  const seedEvents: RadarEvent[] = [
    {
      id: 'radar-1',
      sourceId: 'BEACON',
      sourceName: 'Beacon Bio Intelligence',
      title: 'Sudden Spike in Cholera Cases Reported in Border Region',
      disease: 'Cholera',
      country: 'Yemen',
      lat: 15.5527,
      lng: 48.5164,
      dateReported: '2026-07-28',
      cases: 420,
      deaths: 12,
      cfr: 2.85,
      summary: 'Acute watery diarrhea surge reported across coastal districts. Regional health authorities requesting emergency rehydration stores.',
      sourceUrl: 'https://beacon.bio/alerts/yemen-cholera-2026',
      boardType: 'biological',
      riskLevel: 'High'
    },
    {
      id: 'radar-2',
      sourceId: 'WHO',
      sourceName: 'WHO Disease Outbreak News',
      title: 'Meningococcal Meningitis Outbreak Cluster',
      disease: 'Neisseria meningitidis',
      country: 'Sudan',
      lat: 12.8628,
      lng: 30.2176,
      dateReported: '2026-07-26',
      cases: 85,
      deaths: 9,
      cfr: 10.58,
      summary: 'Laboratory confirmed cases of Serogroup C meningococcal disease in temporary displaced shelters.',
      sourceUrl: 'https://www.who.int/emergencies/disease-outbreak-news/item/sudan-meningitis',
      boardType: 'biological',
      riskLevel: 'Critical'
    },
    {
      id: 'radar-3',
      sourceId: 'PROMED',
      sourceName: 'ProMED-mail Feed',
      title: 'Unusual Avian Influenza H5N1 Detection in Dairy Livestock',
      disease: 'Avian Influenza H5N1',
      country: 'Egypt',
      lat: 26.8206,
      lng: 30.8025,
      dateReported: '2026-07-27',
      cases: 34,
      deaths: 0,
      cfr: 0,
      summary: 'Mammalian transmission alert triggered. Veterinary surveillance confirming viral clade 2.3.4.4b.',
      sourceUrl: 'https://promedmail.org/post/20260727.87192',
      boardType: 'biological',
      riskLevel: 'High'
    },
    {
      id: 'radar-4',
      sourceId: 'ECDC',
      sourceName: 'ECDC Environmental Surveillance',
      title: 'Chemical Contamination Event in Industrial Canal',
      disease: 'Toxic Chemical Exposure',
      country: 'Jordan',
      lat: 31.9522,
      lng: 35.2332,
      dateReported: '2026-07-29',
      cases: 19,
      deaths: 0,
      cfr: 0,
      summary: 'Industrial solvent release resulting in localized respiratory irritation among nearby residents.',
      sourceUrl: 'https://ecdc.europa.eu/en/threats-and-outbreaks/jordan-chemical-incident',
      boardType: 'environmental_cbrn',
      riskLevel: 'Moderate'
    },
    {
      id: 'radar-5',
      sourceId: 'WHO_MPOX',
      sourceName: 'WHO Mpox Global API',
      title: 'Mpox Clade I Cluster Detection',
      disease: 'Mpox Clade I',
      country: 'DR Congo',
      lat: -4.0383,
      lng: 21.7587,
      dateReported: '2026-07-27',
      cases: 112,
      deaths: 4,
      cfr: 3.57,
      summary: 'Sustained person-to-person transmission identified in endemic outbreak provinces.',
      sourceUrl: 'https://xmart-api-public.who.int/MPX/V_MPX_VALIDATED_DAILY',
      boardType: 'biological',
      riskLevel: 'High'
    }
  ];

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

  const cutoffLabel = scanResult?.cutoffDate
    ? new Date(scanResult.cutoffDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'last 14 days';

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
      } else {
        setEvents(seedEvents);
      }
    } catch {
      setEvents(seedEvents);
    }
  };

  useEffect(() => {
    fetchRadarData();
    fetchSources();
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

  const filteredEvents = events.filter(e => {
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

  return (
    <div className="relative w-full h-[calc(100vh-170px)] min-h-[500px] rounded-3xl overflow-hidden border border-white/10 bg-[#060a14] shadow-2xl">
      
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

            {/* Outbreak Markers at Real Longitude & Latitude */}
            {filteredEvents.map((evt) => {
              const isCritical = evt.riskLevel === 'Critical';
              const isSelected = selectedEvent?.id === evt.id;

              return (
                <Marker
                  key={evt.id}
                  coordinates={[evt.lng, evt.lat]}
                  onClick={() => setSelectedEvent(evt)}
                >
                  <g className="cursor-pointer group">
                    {/* Animated Pulsing Radar Ring */}
                    <circle
                      r={isCritical ? 14 : 10}
                      fill={isCritical ? "#FF3131" : "#00F2FF"}
                      opacity="0.35"
                      className="animate-ping"
                    />
                    
                    {/* Outer Border Circle */}
                    <circle
                      r={isCritical ? 8 : 6}
                      fill={isCritical ? "#FF3131" : "#00F2FF"}
                      stroke="#ffffff"
                      strokeWidth={isSelected ? 2 : 1}
                      className="transition-transform duration-300 group-hover:scale-150"
                    />

                    {/* Inner Center Dot */}
                    <circle r="2" fill="#ffffff" />
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
              Retrospective Window Since: <span className="text-ghi-teal">{cutoffLabel}</span>
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
            <option value="all">All Diseases</option>
            {uniqueDiseases.map((d, i) => (
              <option key={i} value={d}>{d}</option>
            ))}
          </select>

          {/* Severity / Risk Level Filter */}
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
            className="bg-slate-900 border border-white/10 rounded-xl px-2 py-1 text-xs text-slate-200 focus:border-ghi-teal outline-none"
          >
            <option value="all">All Severities</option>
            <option value="Critical">Critical Only</option>
            <option value="High">High Only</option>
            <option value="Moderate">Moderate Only</option>
            <option value="Low">Low Only</option>
          </select>

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
              {scanResult.status === 'success' && (
                <p className="mt-1 text-[10px] text-slate-400">All sources responding.</p>
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

      {/* FLOATING ACTION ICON BUTTONS (LEFT SIDE - POSITIONED ABOVE RSS TICKER) */}
      <div className="absolute left-6 bottom-16 flex flex-row md:flex-col gap-2 z-30">
        
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
      <div className="absolute right-6 bottom-16 flex flex-col gap-2 z-30">
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
          <Maximize2 className="w-4 h-4" />
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
      <div className="absolute bottom-4 left-6 right-6 md:right-24 bg-slate-950/90 backdrop-blur-2xl border border-orange-500/30 rounded-2xl p-2 px-3 z-30 shadow-2xl flex items-center gap-3 overflow-hidden">
        
        {/* Live RSS Badge */}
        <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-xl bg-orange-500/20 text-orange-400 border border-orange-500/40 text-[10px] font-black uppercase tracking-wider">
          <Rss className="w-3.5 h-3.5 animate-pulse" />
          <span>LIVE RSS FEED</span>
        </div>

        <div className="h-4 w-[1px] bg-white/10 shrink-0"></div>

        {/* Scrolling Ticker Container (Pauses on Hover) */}
        <div className="flex-1 overflow-hidden relative group">
          <div className="inline-flex gap-8 animate-[marquee_28s_linear_infinite] group-hover:[animation-play-state:paused] whitespace-nowrap text-xs">
            {filteredEvents.concat(filteredEvents).map((evt, idx) => (
              <div
                key={`${evt.id}-${idx}`}
                onClick={() => setSelectedEvent(evt)}
                className="inline-flex items-center gap-2 cursor-pointer hover:text-ghi-teal transition-colors"
              >
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                  evt.riskLevel === 'Critical' ? 'bg-ghi-critical/20 text-ghi-critical border border-ghi-critical/30' : 'bg-ghi-teal/20 text-ghi-teal border border-ghi-teal/30'
                }`}>
                  {evt.sourceId}
                </span>
                <span className="font-bold text-white">{evt.disease} ({evt.country}):</span>
                <span className="text-slate-300 font-medium">{evt.title}</span>
                <span className="text-slate-400 text-[10px]">[{evt.cases} Cases]</span>
                <span className="text-white/20 mx-2">•</span>
              </div>
            ))}
          </div>
        </div>

        {/* RSS XML Link */}
        <a
          href={`${API_BASE_URL}/api/radar/rss`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[10px] font-bold text-orange-400 hover:text-white underline uppercase ml-1"
        >
          XML
        </a>
      </div>
    </div>
  );
}
