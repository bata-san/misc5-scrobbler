import { getConnectorByUrl } from '@/util/util-connector';
import browser from 'webextension-polyfill';
import { isShelfAppOrigin } from '@/core/shelf/origin';

const PLAYBACK_SITE_MATCHES = ['http://*/*', 'https://*/*'];
const PLAYBACK_CONTENT_SCRIPT_ID = 'misc5-playback-sites';
// 旧版のcontent scriptは更新後もタブ内に残る。バージョンを印に含めないと、
// その古い印だけを見て新しいbridgeの再注入を止めてしまう。
const CONTENT_SCRIPT_MARKER = `__misc5ScrobblerContentScriptInstalled_${browser.runtime.getManifest().version}__`;

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
	return isShelfAppOrigin(url);
}

async function injectContentScript(tabId: number): Promise<boolean> {
	const [reservation] = await browser.scripting.executeScript({
		target: { tabId },
		args: [CONTENT_SCRIPT_MARKER],
		func: (marker) => {
			if (typeof marker !== 'string') return false;
			const page = globalThis as unknown as Record<string, boolean>;
			if (page[marker]) return false;
			page[marker] = true;
			return true;
		},
	});
	if (!reservation?.result) return false;

	try {
		await browser.scripting.executeScript({
			target: { tabId },
			files: ['content/main.js'],
		});
		return true;
	} catch (error) {
		await browser.scripting.executeScript({
			target: { tabId },
			args: [CONTENT_SCRIPT_MARKER],
			func: (marker) => {
				if (typeof marker !== 'string') return;
				delete (globalThis as unknown as Record<string, boolean>)[marker];
			},
		});
		throw error;
	}
}

// activeTab is granted when the user opens the extension popup. This keeps
// the connection bridge off every page until that explicit action.
export async function injectShelfBridgeForActiveTab() {
	// `currentWindow` can be the extension popup itself. The popup is opened
	// from a browser tab, so the last focused browser window is the reliable
	// source of the tab that received the activeTab grant.
	const [tab] = await browser.tabs.query({
		active: true,
		lastFocusedWindow: true,
	});
	if (typeof tab?.id !== 'number' || !tab.url || !isShelfAppUrl(tab.url)) return;
	await injectContentScript(tab.id);
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
	if (!playbackEnabled) return;

	const connector = await getConnectorByUrl(url);

	if (!connector) {
		return;
	}

	/**
	 * Important note: We do not check if the script already exists here.
	 * As scripts are always invalidated on reload, and this only runs on install, there is no need.
	 */

	void injectContentScript(tabId);
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
