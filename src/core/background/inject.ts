import { getConnectorByUrl } from '@/util/util-connector';
import browser from 'webextension-polyfill';

const SHELF_APP_ORIGIN = 'https://misc5-shelf.butter3.workers.dev';
const SHELF_APP_MATCHES = ['https://misc5-shelf.butter3.workers.dev/*'];
const PLAYBACK_SITE_MATCHES = ['http://*/*', 'https://*/*'];
const PLAYBACK_CONTENT_SCRIPT_ID = 'misc5-playback-sites';

async function hasPlaybackHostAccess(): Promise<boolean> {
	return browser.permissions.contains({ origins: PLAYBACK_SITE_MATCHES });
}

export async function registerPlaybackContentScript() {
	if (!(await hasPlaybackHostAccess())) return;
	const registered = await browser.scripting.getRegisteredContentScripts({
		ids: [PLAYBACK_CONTENT_SCRIPT_ID],
	});
	if (registered.length) return;
	await browser.scripting.registerContentScripts([
		{
			id: PLAYBACK_CONTENT_SCRIPT_ID,
			matches: PLAYBACK_SITE_MATCHES,
			excludeMatches: SHELF_APP_MATCHES,
			js: ['content/main.js'],
			allFrames: true,
		},
	]);
}

export async function unregisterPlaybackContentScript() {
	await browser.scripting.unregisterContentScripts({
		ids: [PLAYBACK_CONTENT_SCRIPT_ID],
	}).catch(() => undefined);
}

function isShelfAppUrl(url: string): boolean {
	try {
		return new URL(url).origin === SHELF_APP_ORIGIN;
	} catch {
		return false;
	}
}

/**
 * Attempts to inject the connector into the page.
 *
 * Function does not wait for injection to finish, because it can hang if the tab is asleep.
 *
 * @param tab - The tab to inject the connector into
 * @returns A promise that resolves when the connector is being injected.
 */
async function attemptInjectTab(tab: browser.Tabs.Tab, playbackEnabled: boolean) {
	if (typeof tab.id === 'undefined') {
		throw new Error(`Could not identify tab: ${JSON.stringify(tab)}`);
	}

	let url = tab.url;
	if (typeof url === 'undefined') {
		url = await browser.tabs.get(tab.id).then((idTab) => idTab.url);
	}
	if (typeof url === 'undefined') {
		throw new Error(
			`Could not identify URL of tab: ${JSON.stringify(tab)}`,
		);
	}

	return injectConnector(tab.id, url, playbackEnabled);
}

/**
 * Does the actual injection attempt after checking for missing properties.
 *
 * @param tabId - The tab to inject the connector into
 * @param url - The URL of the tab
 * @returns A promise that resolves when the connector is injected
 */
async function injectConnector(tabId: number, url: string, playbackEnabled: boolean) {
	// The Shelf page has no playback connector, but it uses the same content
	// entrypoint for its page <-> extension device-auth bridge. Re-inject it
	// after an extension update so an already-open login page works immediately.
	if (isShelfAppUrl(url)) {
		return browser.scripting.executeScript({
			target: { tabId },
			files: ['content/main.js'],
		});
	}
	if (!playbackEnabled) return;

	const connector = await getConnectorByUrl(url);

	if (!connector) {
		return;
	}

	/**
	 * Important note: We do not check if the script already exists here.
	 * As scripts are always invalidated on reload, and this only runs on install, there is no need.
	 */

	const script = 'content/main.js';
	browser.scripting.executeScript({
		target: { tabId },
		files: [script],
	});
}

/**
 * Attempts to inject content script into all tabs.
 * Ran on extension load, as whenever the extension is updated or reloaded
 * all content scripts are invalidated and stop working.
 * So we need to replace them.
 */
export async function attemptInjectAllTabs() {
	const playbackEnabled = await hasPlaybackHostAccess();
	const tabs = await browser.tabs?.query({});
	for (const tab of tabs ?? []) {
		try {
			await attemptInjectTab(tab, playbackEnabled);
		} catch (err) {
			console.warn('Error while injecting into tab: ', err);
		}
	}
}
