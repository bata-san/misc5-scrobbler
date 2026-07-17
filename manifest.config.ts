import type { Manifest } from 'webextension-polyfill';
import pkg from './package.json';
import { releaseTarget } from './scripts/util';
import connectors from './src/core/connectors';

/**
 * Chrome's actual match-pattern grammar for host_permissions/content_scripts:
 *   <url-pattern> := <scheme>://<host><path>
 *   <host>        := '*' | '*.' <1+ chars, no '/' or '*'> | <1+ chars, no '/' or '*'>
 * `*` may only appear as the whole host or as a `*.` prefix — never as a
 * trailing/mid-string wildcard, and hosts never carry a port. Loading an
 * unpacked extension whose manifest contains even one pattern outside this
 * grammar makes Chrome silently refuse to load the extension AT ALL (no
 * error card, nothing in chrome://extensions — confirmed by testing) rather
 * than rejecting just that one pattern, so every pattern must be validated.
 */
const MATCH_PATTERN_RE = /^(\*|https?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]+)?(\/.*)?$/;

/**
 * Some connectors' `matches` have a `*word.tld` typo missing the dot that
 * makes `*.word.tld` (a valid subdomain wildcard) — e.g. `*technobase.fm`
 * instead of `*.technobase.fm`. Harmless to normalize since it only widens
 * the pattern to also cover the bare domain, which is what was clearly
 * intended. Left as a local transform (not fixed in connectors.ts itself)
 * so the connectors' own runtime URL-matching logic is untouched — this
 * only affects what's declared for eager permission granting.
 */
function normalizeHostWildcard(pattern: string): string {
	const sep = pattern.indexOf('://');
	if (sep === -1) return pattern;
	const scheme = pattern.slice(0, sep + 3);
	const rest = pattern.slice(sep + 3);
	if (rest.length > 1 && rest[0] === '*' && rest[1] !== '.' && rest[1] !== '/') {
		return `${scheme}*.${rest.slice(1)}`;
	}
	return pattern;
}

/**
 * Loading an unpacked extension whose manifest declares several hundred
 * host_permissions/content_scripts patterns makes Chrome silently refuse to
 * load the extension at all (confirmed by testing: 300 patterns loads fine,
 * 450 does not — no error shown anywhere, chrome://extensions just shows an
 * empty list). All ~415 connectors together produce ~600+ patterns even
 * after dedup, well past that point. Rather than the exhaustive set, this is
 * a curated allow-list of major/globally-recognized services — mainstream
 * global platforms plus the largest regional ones (China, Russia, Korea,
 * Japan, India, MENA, etc., since this extension's connector list is
 * genuinely international) — kept well under the working threshold with
 * margin. Everything else still works exactly as before via the existing
 * optional `http(s)://*` permission prompt in
 * src/ui/options/components/permissions.tsx (the user grants it once, and
 * every connector — including these unlisted ones — starts working), so
 * this is a "the common case needs zero extra steps" list, not a hard cutoff
 * of what's supported.
 */
const MAJOR_CONNECTOR_IDS = new Set([
	// Global mainstream
	'youtube', 'youtube-music', 'spotify', 'spotify-embed', 'soundcloud',
	'bandcamp', 'bandcamp-embed', 'bandcamp-daily', 'deezer', 'tidal',
	'apple-music', 'amazon', 'amazon-alexa', 'pandora', 'napster', 'qobuz',
	'audiomack', 'mixcloud', 'audius', 'jamendo', '8tracks', 'beatport',
	'monstercat', 'reverbnation', 'archive', 'newgrounds',
	'nicovideo', 'bilibili',
	// Radio / talk / podcast aggregators, and well-known internet radio
	'tunein', 'iheart', 'siriusxm-player', 'overcast', 'pocketcasts',
	'bbc-sounds', 'npr', 'radiofrance', 'kexp', 'kcrw', 'somafm',
	'radioparadise', 'freemusicarchive', 'wfmu', 'live365', 'redbull',
	// Russia / CIS
	'vk', 'yandex-music', 'zvuk',
	// China
	'163-music', 'qq-music', 'qq-video', 'kugou', 'migu-music', 'weibo',
	// Korea
	'naver', 'naver-vibe', 'music-flo', 'soribada', 'genie', 'bugs',
	// Japan
	'linemusic', 'beatbump', 'listen.moe',
	// South/Southeast Asia
	'jiosaavn', 'gaana', 'wynk', 'joox', 'kkbox', 'zingmp3',
	// MENA
	'anghami', 'radiojavan',
	// Germany (large market for this extension's radio-station connectors)
	'laut.fm', 'wdr', 'swr3', 'fritz', 'rockantenne', 'rtl-plus-musik',
	// Notable/well-known niche services
	'datpiff', 'epidemicsound', 'brainfm', 'calm',
	'hoopladigital', 'idagio', 'invidious', 'piped', 'rainwave',
]);

// The MISC5 app is not a playback connector, but its login-complete screen
// needs this content script for the page <-> extension device-auth bridge.
// Keep this explicit origin outside the connector allow-list so reducing
// playback-site permissions can never silently break account connection.
const SHELF_APP_MATCHES = ['https://misc5-shelf.butter3.workers.dev/*'];

/**
 * The exact set of sites the content script (and its programmatic
 * re-injection on reload, see core/background/inject.ts) needs to run on,
 * instead of a catch-all wildcard matching every http(s) origin. Only the
 * curated MAJOR_CONNECTOR_IDS above are included statically — see that
 * comment for why the full connector list can't be used as-is, and how the
 * rest still works via the optional broad permission prompt.
 *
 * Two further exclusions apply even within that curated set, both also
 * falling back to the same optional permission prompt:
 *  - Self-hosted servers with no fixed public domain (none of the curated
 *    IDs above are self-hosted, but `Array.isArray` guards this generally).
 *  - Connectors whose `matches` can't be expressed as a valid Chrome match
 *    pattern even after the dot-fix above: a TLD wildcard (`amazon.*`,
 *    matching every country domain — Chrome patterns can't wildcard a
 *    suffix, only a prefix) or a bare port number standing in for "any
 *    host, this port" (Plex/Emby/Synology-style — Chrome match patterns
 *    don't support ports at all, and those aren't in the curated list
 *    anyway). `amazon`/`amazon-alexa` are curated-but-affected: their
 *    TLD-wildcard patterns get filtered out here, but `amazon.com`
 *    specifically would still need enumerating per-TLD to work without the
 *    optional-permission prompt — not done here, so Amazon Music currently
 *    relies on that prompt too despite being "major".
 */
const connectorMatches = Array.from(
	new Set(
		connectors
			.filter((c) => MAJOR_CONNECTOR_IDS.has(c.id))
			.filter((c) => Array.isArray(c.matches))
			.flatMap((c) => c.matches)
			.map(normalizeHostWildcard)
			.filter((pattern) => MATCH_PATTERN_RE.test(pattern)),
	),
);

const siteMatches = Array.from(new Set([...connectorMatches, ...SHELF_APP_MATCHES]));

/**
 * Common properties between all browsers manifests
 */
export const common: Manifest.WebExtensionManifest = {
	manifest_version: 3,
	name: 'MISC5 Shelf',
	default_locale: 'en',
	description: 'Sync music playback to MISC5 Shelf.',
	version: pkg.version,

	permissions: ['storage', 'identity', 'contextMenus', 'notifications', 'scripting', 'activeTab'],
	// No host permission is required at install. Playback access is requested
	// after connection; activeTab injects the MISC5 bridge only when the user
	// opens the extension from the currently active Shelf page.
	optional_host_permissions: ['http://*/*', 'https://*/*'],

	web_accessible_resources: [
		{
			resources: ['connectors/*'],
			matches: ['<all_urls>'],
		},
		{
			resources: ['icons/*'],
			matches: ['<all_urls>'],
		},
	],

	icons: {
		16: 'icons/icon_main_16.png',
		48: 'icons/icon_main_48.png',
		96: 'icons/icon_main_96.png',
		128: 'icons/icon_main_128.png',
		256: 'icons/icon_main_256.png',
		512: 'icons/icon_main_512.png',
	},

	options_ui: {
		page: 'src/ui/options/index.html',
		open_in_tab: true,
	},

	action: getAction(releaseTarget),

	commands: {
		'toggle-connector': {
			description: '__MSG_hotkeyToggleConnector__',
		},
	},
};

/**
 * Manifest for chromium browsers
 */
export const chromeManifest: Manifest.WebExtensionManifest = {
	...common,
	background: {
		service_worker: 'background/main.js',
	},
};

/**
 * Manifest for safari
 */
export const safariManifest: Manifest.WebExtensionManifest = {
	...common,
	background: {
		scripts: ['background/main.js'],
		persistent: false,
	},
};

/**
 * Manifest for firefox
 */
export const firefoxManifest: Manifest.WebExtensionManifest = {
	...common,
	background: {
		scripts: ['background/main.js'],
	},

	browser_specific_settings: {
		gecko: {
			id: '{799c0914-748b-41df-a25c-22d008f9e83f}',
			data_collection_permissions: {
				required: ['browsingActivity', 'websiteContent'],
			},
		},
	},

	content_security_policy: {
		extension_pages: "script-src 'self';",
	},
};

/**
 * Gets action with defaults for a browser
 *
 * @param browser - browser to get action for
 * @returns manifest action object
 */
function getAction(browser?: string) {
	// default to light theme in browsers that have themed icon as we cannot dynamically set in manifest.
	const defaultType = browser === 'safari' ? 'safari' : 'light';
	return {
		default_icon: {
			16: `icons/action_unsupported_16_${defaultType}.png`,
			19: `icons/action_unsupported_19_${defaultType}.png`,
			32: `icons/action_unsupported_32_${defaultType}.png`,
			38: `icons/action_unsupported_38_${defaultType}.png`,
		},
		default_title: '__MSG_pageActionUnsupported__',
		default_popup: 'src/ui/popup/index.html',
	};
}
