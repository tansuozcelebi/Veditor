// Public entry point of the IPTV viewer feature module.
// Usage in a host app:  import { IptvViewer } from '@/features/iptv';
export { IptvViewer, type IptvViewerProps } from './components/IptvViewer';
export { loadCatalog, facets, DEFAULT_SOURCES, type Catalog, type Channel, type CatalogSources } from './engine/catalog';
export { parseM3u, cleanName, readQuality, type M3uEntry, type M3uPlaylist } from './engine/m3u';
export { prefs, DEFAULT_SETTINGS, type ViewSettings, type SortKey } from './engine/prefs';
export { canRecord, pickMimeType } from './engine/recorder';
